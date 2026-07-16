import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireUser(request, ['admin', 'engineer', 'operator']);
    console.log('GET /api/machine-status-descriptions called');

    const { data: statusDescriptions, error } = await supabaseAdmin
      .from('machine_status_descriptions')
      .select('*')
      .order('display_order');

    if (error) {
      console.error('Error fetching machine status descriptions:', error);
      return NextResponse.json(
        { 
          success: false,
          error: 'Failed to fetch machine status descriptions'
        },
        { status: 500 }
      );
    }

    console.log(`Successfully fetched ${statusDescriptions?.length || 0} status descriptions`);

    return NextResponse.json({
      success: true,
      data: statusDescriptions || [],
      count: statusDescriptions?.length || 0
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Unexpected error in GET /api/machine-status-descriptions:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    );
  }
}
