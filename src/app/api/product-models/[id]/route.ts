import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';

// GET /api/product-models/[id] - 특정 생산 모델 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireUser(request, ['admin', 'engineer', 'operator']);
    console.log('GET /api/product-models/[id] called with id:', id);

    const { data: model, error } = await supabaseAdmin
      .from('product_models')
      .select(`
        id,
        model_name,
        description,
        is_active,
        created_at,
        updated_at
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Supabase error:', error);
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { success: false, error: 'Product model not found' },
          { status: 404 }
        );
      }
      throw error;
    }

    console.log('Successfully fetched product model:', model?.model_name);

    return NextResponse.json({
      success: true,
      model: model
    });

  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error in GET /api/product-models/[id]:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch product model',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}
