import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/product-models/[id] - 특정 생산 모델 조회
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    console.log('GET /api/product-models/[id] called with id:', params.id);

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
      .eq('id', params.id)
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

  } catch (error: any) {
    console.error('Error in GET /api/product-models/[id]:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch product model',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}