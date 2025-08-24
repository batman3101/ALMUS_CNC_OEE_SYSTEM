import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// GET /api/product-models - 활성화된 제품 모델 목록 조회
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    
    const { data: models, error } = await supabase
      .from('product_models')
      .select('*')
      .eq('is_active', true)
      .order('model_name');

    if (error) {
      console.error('Error fetching product models:', error);
      return NextResponse.json(
        { error: 'Failed to fetch product models', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(models || []);
  } catch (error) {
    console.error('Unexpected error in product models API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

// POST /api/product-models - 새로운 제품 모델 생성 (관리자용)
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();
    
    const { model_name, description, is_active = true } = body;

    if (!model_name) {
      return NextResponse.json(
        { error: 'Model name is required' },
        { status: 400 }
      );
    }

    const { data: newModel, error } = await supabase
      .from('product_models')
      .insert({
        model_name,
        description,
        is_active
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating product model:', error);
      return NextResponse.json(
        { error: 'Failed to create product model', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(newModel, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in product models POST API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}