import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/admin/users - 모든 사용자 목록 조회
export async function GET() {
  try {
    // Get user profiles
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
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
    const body = await request.json();
    const { email, password, name, role, assigned_machines } = body;

    // Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) {
      throw authError;
    }

    if (!authData.user) {
      throw new Error('Failed to create user');
    }

    // Create user profile
    const { data: profileData, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .insert([{
        user_id: authData.user.id,
        name,
        role,
        assigned_machines: role === 'operator' ? assigned_machines : null
      }])
      .select()
      .single();

    if (profileError) {
      // Rollback: delete the auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw profileError;
    }

    return NextResponse.json({
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
        name: profileData.name,
        role: profileData.role,
        assigned_machines: profileData.assigned_machines
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/users - 사용자 삭제
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

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