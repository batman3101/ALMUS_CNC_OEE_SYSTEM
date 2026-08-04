import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  apiAuthErrorResponse,
  assertCanAssignRole,
  assertCanManageAccount,
  fetchAccountRole,
  requireUserManager,
} from '@/lib/apiAuth';

// PUT /api/admin/users/[userId] - 사용자 정보 수정
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const actor = await requireUserManager(request);

    const { userId } = await params;
    const body = await request.json();
    const { email, name, role, assigned_machines, currentEmail } = body;

    // 두 가지를 따로 본다.
    //  1. 이 계정을 손대도 되는가 — 관리자는 시스템 관리자 계정을 편집할 수 없다.
    //     이메일만 바꿔도 그 주소로 비밀번호를 재설정해 그 계정이 될 수 있기 때문이다.
    //  2. 역할을 바꾸려 하는가 — 역할 변경은 시스템 관리자 전용이다.
    // 현재 역할은 본문이 아니라 DB 에서 읽는다(본문은 호출자가 지어낼 수 있다).
    const currentRole = await fetchAccountRole(userId);
    assertCanManageAccount(actor.role, currentRole);
    assertCanAssignRole(actor.role, currentRole, role);

    /**
     * 이메일을 **먼저** 바꾼다.
     *
     * 예전에는 프로필을 먼저 쓰고 Auth 이메일을 나중에 바꿨는데, Auth 변경이 실패해도
     * 프로필만 성공하면 200 을 돌려줬다. 관리자 화면에는 "수정됨"이 뜨는데 로그인 이메일은
     * 그대로였고, 화면과 사실이 어긋난 것을 알아챌 방법이 없었다.
     *
     * 순서를 뒤집으면 실패가 **아무것도 바꾸지 않은 상태**로 끝난다. 되돌릴 것이 없는 실패가
     * 가장 다루기 쉬운 실패다.
     */
    if (email && email !== currentEmail) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { email }
      );

      // 가상/테스트 계정(Auth 사용자 없음)은 프로필만 있는 것이 정상이다.
      const authUserMissing =
        authError && (authError.status === 404 || authError.code === 'user_not_found');

      if (authError && !authUserMissing) {
        console.error('Error updating auth user:', authError);
        return NextResponse.json(
          {
            error: 'Failed to update login email',
            message:
              '로그인 이메일을 변경하지 못했습니다. 다른 정보도 저장되지 않았습니다. 잠시 후 다시 시도해 주세요.'
          },
          { status: 502 }
        );
      }

      if (authUserMissing) {
        console.log('Auth user not found (virtual/test user) - skipping email update');
      }
    }

    // 모든 역할에서 담당 설비 저장 가능 (관리자가 모든 역할의 설비 할당 관리 가능)
    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .update({
        name,
        role,
        assigned_machines: assigned_machines || [],
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (profileError) {
      console.error('Error updating user profile:', profileError);
      // 이메일은 이미 바뀌었을 수 있다. 그 사실을 숨기지 않는다 — 관리자가 무엇을 확인해야
      // 하는지 알아야 다시 시도할지 판단할 수 있다.
      return NextResponse.json(
        {
          error: 'Failed to update user profile',
          message:
            '로그인 이메일은 변경됐지만 프로필 저장에 실패했습니다. 사용자 목록을 새로고침해 현재 상태를 확인해 주세요.'
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'User updated completely' });

  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error updating user:', error);
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/users/[userId] - 특정 사용자 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const actor = await requireUserManager(request);

    const { userId } = await params;
    // 관리자는 시스템 관리자 계정을 지울 수 없다 — 전부 지우면 아무도 설정에 못 들어간다.
    assertCanManageAccount(actor.role, await fetchAccountRole(userId));

    /**
     * 삭제 순서를 정하는 기준은 "실패했을 때 무엇이 남는가"다.
     *
     * 예전 순서는 ① `machine_logs.operator_id = NULL` → ② 프로필 삭제 → ③ Auth 삭제 였고,
     * ③이 실패해도 ②가 됐으면 **200 을 돌려줬다**. 그 결과 남는 것은
     * **로그인은 되는데 프로필이 없는 계정**이다. 그 사용자는 로그인에 성공한 뒤
     * `requireUser` 의 403 을 맞아 모든 화면이 깨지고, 관리자 목록에는 보이지 않으니
     * 되살릴 방법도 없다 — 복구 불가능한 상태가 성공으로 보고됐다.
     *
     * 지금은 Auth 를 **먼저** 지운다. 뒤 단계가 실패하면 남는 것은 "고아 프로필"이고,
     * 그건 목록에 보이므로 다시 시도할 수 있다. 두 실패 모두 나쁘지만, 하나만 되돌릴 수 있다.
     */
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    const authUserMissing =
      authError && (authError.status === 404 || authError.code === 'user_not_found');

    if (authError && !authUserMissing) {
      console.error('Error deleting auth user:', authError);
      // 아직 아무것도 바꾸지 않았다. 되돌릴 것이 없는 실패다.
      return NextResponse.json(
        {
          error: 'Failed to delete auth user',
          message: '로그인 계정을 삭제하지 못했습니다. 변경된 내용은 없습니다.'
        },
        { status: 502 }
      );
    }

    if (authUserMissing) {
      console.log('Auth user not found (virtual/test user) - continuing with profile cleanup');
    }

    /**
     * 프로필을 참조하는 외래키를 **전부** 비운다.
     *
     * `machine_logs.operator_id` 와 `downtime_entries.operator_id` 둘 다
     * `user_profiles.user_id` 를 `ON DELETE NO ACTION` 으로 참조한다. 예전 코드는
     * `machine_logs` 만 비웠기 때문에, 비가동을 한 번이라도 기록한 사용자는 프로필 삭제가
     * **FK 위반으로 반드시 실패**했다. 그런데 그때는 이미 `machine_logs` 귀속을 지운 뒤라,
     * 실패한 삭제가 되돌릴 수 없는 손실만 남겼다.
     *
     * 참조 테이블이 늘어나면 여기도 늘어난다. 하나라도 빠지면 같은 실패가 되돌아온다.
     */
    const referencingTables = ['machine_logs', 'downtime_entries'] as const;

    for (const table of referencingTables) {
      const { error } = await supabaseAdmin
        .from(table)
        .update({ operator_id: null })
        .eq('operator_id', userId);

      if (error) {
        console.error(`Error clearing operator reference in ${table}:`, error);
        return NextResponse.json(
          {
            error: 'Failed to clear operator references',
            message:
              '작업 이력의 담당자 표시를 정리하지 못해 삭제를 중단했습니다. 로그인 계정은 이미 삭제됐으니 사용자 목록에서 상태를 확인해 주세요.'
          },
          { status: 500 }
        );
      }
    }

    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .delete()
      .eq('user_id', userId);

    if (profileError) {
      console.error('Error deleting user profile:', profileError);
      return NextResponse.json(
        {
          error: 'Failed to delete user profile',
          message:
            '로그인 계정은 삭제됐지만 프로필이 남았습니다. 사용자 목록에서 다시 삭제해 주세요.'
        },
        { status: 500 }
      );
    }

    console.log('User deleted successfully');
    return NextResponse.json({ success: true, message: 'User deleted completely' });

  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}
