import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// POST /api/admin/setup-real-user - 실제 사용자를 user_profiles에 등록
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, name, role = 'admin' } = body;

    if (!email || !name) {
      return NextResponse.json(
        { error: 'Email and name are required' },
        { status: 400 }
      );
    }

    // 1. Authentication 테이블에서 사용자 찾기
    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (authError) {
      console.error('Error fetching auth users:', authError);
      return NextResponse.json(
        { error: 'Failed to fetch authentication users' },
        { status: 500 }
      );
    }

    const authUser = authUsers.users.find(user => user.email === email);
    
    if (!authUser) {
      return NextResponse.json(
        { error: `User with email ${email} not found in authentication` },
        { status: 404 }
      );
    }

    // 2. user_profiles 테이블에 추가 또는 업데이트
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .upsert({
        user_id: authUser.id,
        name: name,
        role: role,
        email: email,
        is_active: true,
        assigned_machines: [],
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (profileError) {
      console.error('Error upserting user profile:', profileError);
      return NextResponse.json(
        { error: 'Failed to create/update user profile' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `User profile created/updated successfully`,
      user: {
        id: authUser.id,
        email: authUser.email,
        name: userProfile.name,
        role: userProfile.role,
        created_at: authUser.created_at
      }
    });

  } catch (error) {
    console.error('Error in setup-real-user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/admin/setup-real-user - Authentication 사용자 목록 조회
export async function GET(request: NextRequest) {
  try {
    // Authentication 테이블에서 모든 사용자 조회
    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (authError) {
      console.error('Error fetching auth users:', authError);
      return NextResponse.json(
        { error: 'Failed to fetch authentication users' },
        { status: 500 }
      );
    }

    // user_profiles 테이블의 기존 사용자들 조회
    const { data: existingProfiles, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, name, role');

    if (profileError) {
      console.error('Error fetching user profiles:', profileError);
    }

    const existingProfileMap = new Map(
      (existingProfiles || []).map(profile => [profile.user_id, profile])
    );

    const users = authUsers.users.map(user => ({
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      email_confirmed_at: user.email_confirmed_at,
      last_sign_in_at: user.last_sign_in_at,
      hasProfile: existingProfileMap.has(user.id),
      profileInfo: existingProfileMap.get(user.id) || null
    }));

    return NextResponse.json({
      authUsers: users,
      totalCount: users.length,
      profilesCount: existingProfiles?.length || 0
    });

  } catch (error) {
    console.error('Error in setup-real-user GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}