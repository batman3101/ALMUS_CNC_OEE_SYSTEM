import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/model-processes/[id] - 특정 공정 정보 조회
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    console.log('GET /api/model-processes/[id] called with id:', params.id);

    const { data: process, error } = await supabaseAdmin
      .from('model_processes')
      .select(`
        id,
        model_id,
        process_name,
        process_order,
        tact_time_seconds,
        created_at,
        updated_at,
        product_models:model_id (
          id,
          model_name,
          description
        )
      `)
      .eq('id', params.id)
      .single();

    if (error) {
      console.error('Supabase error:', error);
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { success: false, error: 'Process not found' },
          { status: 404 }
        );
      }
      throw error;
    }

    console.log('Successfully fetched process:', process?.process_name);

    return NextResponse.json({
      success: true,
      process: process
    });

  } catch (error: unknown) {
    console.error('Error in GET /api/model-processes/[id]:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch process',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}