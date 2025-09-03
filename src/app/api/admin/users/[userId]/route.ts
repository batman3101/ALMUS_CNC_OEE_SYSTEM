import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// PUT /api/admin/users/[userId] - 사용자 정보 수정
export async function PUT(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const { userId } = params;
    const body = await request.json();
    const { email, name, role, assigned_machines, currentEmail } = body;

    let profileUpdated = false;
    let authUpdated = false;

    // Update user profile
    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .update({
        name,
        role,
        assigned_machines: role === 'operator' ? assigned_machines : null,
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
  { params }: { params: { userId: string } }
) {
  try {
    const { userId } = params;
    let profileDeleted = false;
    let authDeleted = false;

    // Delete user profile first
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
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}