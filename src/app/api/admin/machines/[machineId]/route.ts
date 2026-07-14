import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ApiAuthError, requireUser } from '@/lib/apiAuth';
import {
  applyMachineUpdate,
  machineUpdateErrorResponse,
  pickMachineUpdates
} from '@/lib/machineUpdate';

/**
 * 이 라우트는 서비스 롤(RLS 우회)로 동작하는데, src/middleware.ts 가 `/api` 를 matcher 에서
 * 제외하므로 프레임워크 차원의 인증이 전혀 걸리지 않는다. 따라서 라우트가 직접 세션과
 * 역할을 검사해야 한다. 검사하지 않으면 누구나 설비 테이블을 쓸 수 있다.
 */

function authErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  }
  return null;
}

// PUT /api/admin/machines/[machineId] - 설비 정보 수정 (관리자 전용)
export async function PUT(
  request: NextRequest,
  { params }: { params: { machineId: string } }
) {
  try {
    const { userId } = await requireUser(request, ['admin']);

    const body = await request.json();

    // 화이트리스트: 요청 본문을 그대로 펼치지 않는다.
    // (이전 구현은 `.update({ ...body })` 라 id/created_at 등 아무 컬럼이나 덮어쓸 수 있었다)
    const updates = pickMachineUpdates(body);

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    // 상태 변경 시 machine_logs / machine_status_history 기록까지 단일 트랜잭션으로 처리된다.
    // (이전 구현은 machines 테이블만 직접 UPDATE 하여 상태 이력이 남지 않았다)
    const result = await applyMachineUpdate(
      params.machineId,
      updates,
      typeof body.change_reason === 'string' ? body.change_reason : null,
      userId
    );

    return NextResponse.json({ success: true, machine: result.machine });
  } catch (error) {
    const authMapped = authErrorResponse(error);
    if (authMapped) return authMapped;

    // 존재하지 않는 설비는 404 로 응답한다 (이전 구현은 성공으로 응답했다)
    const mapped = machineUpdateErrorResponse(error);
    if (mapped) return mapped;

    console.error('Error updating machine:', error);
    return NextResponse.json({ success: false, error: 'Failed to update machine' }, { status: 500 });
  }
}

// DELETE /api/admin/machines/[machineId] - 설비 삭제 (관리자 전용)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { machineId: string } }
) {
  try {
    await requireUser(request, ['admin']);

    // 삭제 대상이 실제로 존재하는지 먼저 확인한다 (없는 ID 를 성공으로 응답하지 않기 위해)
    const { data: deleted, error } = await supabaseAdmin
      .from('machines')
      .delete()
      .eq('id', params.machineId)
      .select('id')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Machine not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const authMapped = authErrorResponse(error);
    if (authMapped) return authMapped;

    console.error('Error deleting machine:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete machine' }, { status: 500 });
  }
}
