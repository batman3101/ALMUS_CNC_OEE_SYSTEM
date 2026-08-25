import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  apiAuthErrorResponse,
  assertCanManageAccount,
  fetchAccountRole,
  parseUserRole,
} from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { USER_MANAGEMENT_ROLES } from '@/lib/pageAccess';
import { redactSecrets } from '@/lib/redactSecrets';
import {
  assertSoleFactory,
  assertTargetInFactory,
  factoryMemberIds,
  factoryUserErrorResponse,
} from '@/lib/factoryUserAdmin';

// GET /api/admin/users - 모든 사용자 목록 조회
export async function GET(request: NextRequest) {
  try {
    const actor = await requireFactoryUser(request, [...USER_MANAGEMENT_ROLES]);

    // 이 공장의 구성원만 보여준다. `user_profiles` 에는 factory_id 가 없으므로 공장 조건은
    // membership 이 준다 — 전환 전에는 이 조건이 없어 ALV 관리자가 ALT 사용자를 전부 봤다.
    const memberIds = await factoryMemberIds(actor.factoryId);
    if (memberIds.length === 0) {
      return NextResponse.json({ users: [] });
    }

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .in('user_id', memberIds)
      .order('created_at', { ascending: false });

    if (profileError) {
      throw profileError;
    }

    // Get auth users to get email addresses
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (authError) {
      throw authError;
    }

    // Combine profile and auth data
    const usersWithEmail = (profiles || []).map(profile => {
      const authUser = authData.users.find(u => u.id === profile.user_id);
      return {
        id: profile.user_id,
        email: authUser?.email || '',
        name: profile.name,
        role: profile.role,
        assigned_machines: profile.assigned_machines,
        created_at: profile.created_at
      };
    });

    return NextResponse.json({ users: usersWithEmail });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    // 404(다른 공장)·409(여러 공장 소속)·500(조회 실패)은 인가 실패가 아니므로 위에서
    // 걸리지 않는다. 여기서 옮기지 않으면 전부 "Failed to ..." 500 으로 뭉개진다.
    const factoryResponse = factoryUserErrorResponse(error);
    if (factoryResponse) return factoryResponse;

    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}

// POST /api/admin/users - 새 사용자 생성
export async function POST(request: NextRequest) {
  try {
    const actor = await requireFactoryUser(request, [...USER_MANAGEMENT_ROLES]);

    const body = await request.json();
    // 본문에는 관리자가 방금 입력한 평문 비밀번호가 들어 있다 — 절대 그대로 찍지 않는다.
    console.log('🔍 받은 요청 데이터:', JSON.stringify(redactSecrets(body), null, 2));
    const { email, password, name, role, assigned_machines } = body;

    // 관리자(engineer)는 계정을 만들 수 있지만 **시스템 관리자 계정은 못 만든다**.
    // 만들 수 있으면 그 비밀번호로 로그인해 설정에 도달하므로 역할 변경과 같아진다.
    // 인증 계정을 만들기 **전에** 검사한다 — 뒤에 하면 롤백해야 할 계정이 먼저 생긴다.
    assertCanManageAccount(actor.role, parseUserRole(role));

    let authUserId = null;

    // Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) {
      console.error('Error creating auth user:', authError);
      throw new Error(`사용자 인증 계정 생성 실패: ${authError.message}`);
    }

    if (!authData.user) {
      throw new Error('Failed to create auth user');
    }

    authUserId = authData.user.id;
    console.log('Auth user created successfully:', authUserId);

    // 프로필과 공장 membership 을 **한 트랜잭션으로** 만든다.
    //
    // 전에는 프로필만 만들었다. membership 이 없는 사용자는 `requireFactoryUser` 에서 403 을
    // 받고 RLS 의 `current_user_factory()` 도 NULL 을 내므로, **로그인은 되는데 화면이 텅 빈**
    // 상태가 된다. 그 사실은 사용자 관리 화면 어디에도 드러나지 않는다.
    //
    // 둘을 따로 쓰면 하나만 성공하는 창이 생기므로 RPC 한 번으로 묶는다. 담당 설비는
    // 프로필 INSERT 가 깨우는 트리거가 `user_machine_assignments` 로 옮긴다(20260824230000).
    //
    // 모든 역할에서 담당 설비 저장 가능 (관리자가 모든 역할의 설비 할당 관리 가능)
    const { error: provisionError } = await supabaseAdmin.rpc('create_factory_user', {
      p_factory_id: actor.factoryId,
      p_user_id: authUserId,
      p_name: name,
      p_email: email,
      p_role: role,
      p_assigned_machines: assigned_machines || []
    });

    if (provisionError) {
      console.error('Error creating user profile:', provisionError);
      // Rollback: 프로필도 membership 도 없이 인증 계정만 남으면, 로그인은 되는데 아무것도
      // 없는 계정이 된다. 그 상태가 가장 나쁘다.
      if (authUserId) {
        console.log('Rolling back auth user creation');
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
      }
      throw new Error(`사용자 프로필 생성 실패: ${provisionError.message}`);
    }

    const { data: profileData, error: profileReadError } = await supabaseAdmin
      .from('user_profiles')
      .select()
      .eq('user_id', authUserId)
      .single();

    if (profileReadError || !profileData) {
      // 만들어졌는데 되읽지 못한 상황이다. 계정 자체는 정상이므로 롤백하지 않는다 —
      // 여기서 지우면 방금 만들어진 멀쩡한 계정을 없애는 것이 된다.
      throw new Error('사용자는 생성됐지만 정보를 다시 읽지 못했습니다. 목록을 새로고침해 주세요.');
    }

    console.log('User created successfully:', {
      authId: authUserId,
      profileId: profileData.user_id
    });

    return NextResponse.json({
      success: true,
      user: {
        id: authUserId,
        email: authData.user.email,
        name: profileData.name,
        role: profileData.role,
        assigned_machines: profileData.assigned_machines
      }
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    // 404(다른 공장)·409(여러 공장 소속)·500(조회 실패)은 인가 실패가 아니므로 위에서
    // 걸리지 않는다. 여기서 옮기지 않으면 전부 "Failed to ..." 500 으로 뭉개진다.
    const factoryResponse = factoryUserErrorResponse(error);
    if (factoryResponse) return factoryResponse;

    console.error('Error creating user:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to create user';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/users - 사용자 삭제
export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireFactoryUser(request, [...USER_MANAGEMENT_ROLES]);

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // 대상이 이 공장 사람인지 먼저 본다. 아니면 404 다 — 403 은 "그 id 는 존재한다"를
    // 알려주므로, 다른 공장 사용자 id 를 하나씩 확인하는 수단이 된다.
    await assertTargetInFactory(actor.factoryId, userId);
    await assertSoleFactory(userId, actor.factoryId);

    // 대상의 역할은 **DB 에서** 읽는다. 관리자는 시스템 관리자 계정을 지울 수 없다 —
    // 지울 수 있으면 시스템 관리자를 전부 없애 아무도 설정에 못 들어가게 만들 수 있다.
    assertCanManageAccount(actor.role, await fetchAccountRole(userId));

    // Delete user profile first
    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .delete()
      .eq('user_id', userId);

    if (profileError) {
      throw profileError;
    }

    // Delete auth user
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    
    if (authError) {
      throw authError;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    // 404(다른 공장)·409(여러 공장 소속)·500(조회 실패)은 인가 실패가 아니므로 위에서
    // 걸리지 않는다. 여기서 옮기지 않으면 전부 "Failed to ..." 500 으로 뭉개진다.
    const factoryResponse = factoryUserErrorResponse(error);
    if (factoryResponse) return factoryResponse;

    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}
