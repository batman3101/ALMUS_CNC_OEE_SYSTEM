import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// GET /api/model-processes - 특정 모델의 공정 목록 조회
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const modelId = searchParams.get('model_id');

    if (!modelId) {
      return NextResponse.json(
        { error: 'Model ID is required' },
        { status: 400 }
      );
    }

    const { data: processes, error } = await supabase
      .from('model_processes')
      .select(`
        *,
        product_models!inner(
          id,
          model_name,
          is_active
        )
      `)
      .eq('model_id', modelId)
      .eq('product_models.is_active', true)
      .order('process_order');

    if (error) {
      console.error('Error fetching model processes:', error);
      return NextResponse.json(
        { error: 'Failed to fetch model processes', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(processes || []);
  } catch (error) {
    console.error('Unexpected error in model processes API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

// POST /api/model-processes - 새로운 공정 생성 (관리자용)
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();
    
    const { model_id, process_name, process_order, tact_time_seconds = 120 } = body;

    if (!model_id || !process_name || process_order === undefined) {
      return NextResponse.json(
        { error: 'Model ID, process name, and process order are required' },
        { status: 400 }
      );
    }

    // Check if model exists and is active
    const { data: model, error: modelError } = await supabase
      .from('product_models')
      .select('id, is_active')
      .eq('id', model_id)
      .eq('is_active', true)
      .single();

    if (modelError || !model) {
      return NextResponse.json(
        { error: 'Product model not found or inactive' },
        { status: 404 }
      );
    }

    const { data: newProcess, error } = await supabase
      .from('model_processes')
      .insert({
        model_id,
        process_name,
        process_order,
        tact_time_seconds
      })
      .select(`
        *,
        product_models!inner(
          id,
          model_name
        )
      `)
      .single();

    if (error) {
      console.error('Error creating model process:', error);
      return NextResponse.json(
        { error: 'Failed to create model process', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(newProcess, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in model processes POST API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}