import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getEnvConfig } from '@/lib/env-validation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    console.log('🔧 [API] Profile Admin Route - GET request started');
    
    // Get user_id from query parameters
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    
    if (!userId) {
      console.error('❌ [API] Missing user_id parameter');
      return NextResponse.json(
        { error: 'Missing user_id parameter' },
        { status: 400 }
      );
    }

    console.log('🔍 [API] Querying profile for user_id:', userId);

    // Validate environment configuration
    const env = getEnvConfig();
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('❌ [API] Missing SUPABASE_SERVICE_ROLE_KEY');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Create Service Role client (server-side only)
    const adminClient = createServerClient();
    console.log('✅ [API] Service Role client created successfully');

    // Query user profile using Service Role (bypasses RLS)
    const { data: profile, error } = await adminClient
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('❌ [API] Profile query error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      
      // Handle "no rows found" error specifically
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Profile not found', profile: null },
          { status: 404 }
        );
      }
      
      return NextResponse.json(
        { error: 'Database query failed', details: error.message },
        { status: 500 }
      );
    }

    console.log('✅ [API] Profile retrieved successfully:', {
      userId: profile.user_id,
      email: profile.email,
      role: profile.role
    });

    return NextResponse.json({
      success: true,
      profile: profile
    });

  } catch (error: unknown) {
    console.error('❌ [API] Unexpected error in profile admin route:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}