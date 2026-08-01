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

    let profileUpdated = false;
    let authUpdated = false;

    // Update user profile
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
    } else {
      profileUpdated = true;
      console.log('User profile updated successfully');
    }

    // Update auth user email if changed (only for real auth users)
    if (email && email !== currentEmail) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { email }
      );
      
      if (authError) {
        if (authError.status === 404 || authError.code === 'user_not_found') {
          console.log('Auth user not found (virtual/test user) - skipping email update');
          authUpdated = true; // Consider as success for virtual users
        } else {
          console.error('Error updating auth user:', authError);
        }
      } else {
        authUpdated = true;
        console.log('Auth user email updated successfully');
      }
    } else {
      authUpdated = true; // No email change needed
      console.log('No email change required');
    }

    // Success if profile was updated (covers both real and virtual users)
    if (profileUpdated) {
      return NextResponse.json({ 
        success: true, 
        message: authUpdated ? 'User updated completely' : 'Virtual user profile updated' 
      });
    }

    // If profile update failed, return error
    throw new Error('Failed to update user profile');

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

    let profileDeleted = false;
    let authDeleted = false;

    // IMPORTANT: Clear foreign key references first
    // Update machine_logs to remove operator references
    const { error: logsUpdateError } = await supabaseAdmin
      .from('machine_logs')
      .update({ operator_id: null })
      .eq('operator_id', userId);

    if (logsUpdateError) {
      console.warn('Error updating machine logs:', logsUpdateError);
    }

    // Delete user profile
    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .delete()
      .eq('user_id', userId);

    if (profileError) {
      console.error('Error deleting user profile:', profileError);
    } else {
      profileDeleted = true;
      console.log('User profile deleted successfully');
    }

    // Try to delete auth user (ignore if user not found - for test/virtual users)
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    
    if (authError) {
      if (authError.status === 404 || authError.code === 'user_not_found') {
        console.log('Auth user not found (virtual/test user) - ignoring auth deletion');
        authDeleted = true; // Consider as success for virtual users
      } else {
        console.error('Error deleting auth user:', authError);
      }
    } else {
      authDeleted = true;
      console.log('Auth user deleted successfully');
    }

    // Success if at least profile was deleted (covers both real and virtual users)
    if (profileDeleted) {
      return NextResponse.json({ 
        success: true, 
        message: authDeleted ? 'User deleted completely' : 'Virtual user profile deleted' 
      });
    }

    // If profile deletion failed, return error
    throw new Error('Failed to delete user profile');

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
