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
      throw profileError;
    }

    // Update auth user email if changed
    if (email && email !== currentEmail) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { email }
      );
      
      if (authError) {
        throw authError;
      }
    }

    return NextResponse.json({ success: true });
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
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}