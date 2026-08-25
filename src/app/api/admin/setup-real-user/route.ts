import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';

// POST /api/admin/setup-real-user - 실제 사용자를 user_profiles에 등록
export async function POST(request: NextRequest) {
  try {
    const actor = await requireFactoryUser(request, ['admin']);

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

    // 2. 공장 membership 을 **먼저** 보장한다.
    //
    // 프로필만 만들면 그 사용자는 로그인은 되는데 `requireFactoryUser` 가 403 을 내고 RLS 의
    // `current_user_factory()` 는 NULL 을 낸다 — 화면이 통째로 빈다. 이 경로는 관리자를
    // 등록하는 자리라 그 상태가 특히 나쁘다(설정에 들어갈 사람이 없어진다).
    //
    // 공장은 지금 이 작업을 하는 관리자의 공장이다. 요청 본문은 공장을 정하지 못한다.
    const { error: membershipError } = await supabaseAdmin
      .from('factory_memberships')
      .upsert(
        {
          factory_id: actor.factoryId,
          user_id: authUser.id,
          role,
          is_active: true,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'factory_id,user_id' }
      );

    if (membershipError) {
      console.error('Error upserting factory membership:', membershipError);
      return NextResponse.json(
        { error: '공장 구성원 등록에 실패했습니다' },
        { status: 500 }
      );
    }

    // 3. user_profiles 테이블에 추가 또는 업데이트
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
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

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
    await requireUser(request, ['admin']);

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
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error in setup-real-user GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
