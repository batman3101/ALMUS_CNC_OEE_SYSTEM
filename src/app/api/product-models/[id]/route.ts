import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';

// GET /api/product-models/[id] - 특정 생산 모델 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const factoryUser = await requireFactoryUser(request, ['admin', 'engineer', 'operator']);
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
      .eq('factory_id', factoryUser.factoryId)
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

/**
 * 모델 마스터 쓰기는 **여기에만** 있다.
 *
 * 예전에는 `ModelInfoManager` 가 브라우저 Supabase 클라이언트로 `product_models` 를 직접
 * 고쳤다. 그래서 규칙이 두 벌이었다 — API 는 admin/engineer 를 요구하고 `is_active` 도 보는데,
 * 실제로 쓰이던 경로(PostgREST + RLS)는 역할만 보고 `is_active` 를 보지 않았다.
 * 즉 **약한 쪽 규칙이 실제 규칙**이었다. 쓰기를 서버로 모아 규칙을 하나로 만든다.
 */

// PUT /api/product-models/[id] - 모델 수정
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const factoryUser = await requireFactoryUser(request, ['admin', 'engineer']);

    const body = await request.json();
    const modelName = typeof body.model_name === 'string' ? body.model_name.trim() : '';
    const description =
      typeof body.description === 'string' ? body.description : null;

    if (!modelName) {
      return NextResponse.json({ error: 'Model name is required' }, { status: 400 });
    }

    const { data: updated, error } = await supabaseAdmin
      .from('product_models')
      .update({ model_name: modelName, description })
      .eq('id', id)
      .select()
      .eq('factory_id', factoryUser.factoryId)
      .maybeSingle();

    if (error) {
      // 이름 중복은 사용자가 고칠 수 있는 입력 오류다 — 500 으로 뭉뚱그리면
      // "다시 시도"만 반복하게 된다.
      if (error.code === '23505') {
        return NextResponse.json({ error: 'duplicate_name' }, { status: 409 });
      }
      console.error('Error updating product model:', error);
      return NextResponse.json({ error: 'Failed to update product model' }, { status: 500 });
    }

    if (!updated) {
      return NextResponse.json({ error: 'Product model not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, model: updated });
  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Unexpected error in PUT /api/product-models/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/product-models/[id] - 모델 비활성화(소프트 삭제).
 *
 * 행을 지우지 않는다. `model_processes` 와 과거 생산 기록이 이 모델을 가리키고 있어서,
 * 실제로 지우면 과거가 읽히지 않게 된다(스냅샷 보존 원칙과 같은 이유).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const factoryUser = await requireFactoryUser(request, ['admin', 'engineer']);

    const { data: deactivated, error } = await supabaseAdmin
      .from('product_models')
      .update({ is_active: false })
      .eq('id', id)
      .select('id')
      .eq('factory_id', factoryUser.factoryId)
      .maybeSingle();

    if (error) {
      console.error('Error deactivating product model:', error);
      return NextResponse.json({ error: 'Failed to delete product model' }, { status: 500 });
    }

    if (!deactivated) {
      return NextResponse.json({ error: 'Product model not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Unexpected error in DELETE /api/product-models/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
