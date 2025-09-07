import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET() {
  try {
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
          error: 'Failed to fetch machine status descriptions',
          message: error.message 
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
    console.error('Unexpected error in GET /api/machine-status-descriptions:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}