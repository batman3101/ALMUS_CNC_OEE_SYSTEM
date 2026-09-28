import { NextRequest, NextResponse } from 'next/server';
import { ApiAuthError } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';
import {
  applyMachineUpdate,
  assertMachineInFactory,
  machineUpdateErrorResponse,
  pickMachineUpdates
} from '@/lib/machineUpdate';

/**
 * 이 라우트는 서비스 롤(RLS 우회)로 동작하는데, src/proxy.ts 가 `/api` 를 matcher 에서
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
  { params }: { params: Promise<{ machineId: string }> }
) {
  try {
    const { machineId } = await params;
    const authenticatedUser = await requireFactoryUser(request, ['admin', 'engineer']);
    // 남의 공장 설비는 이 공장에서 **없는 것**이다. RPC 를 부르기 전에 끊는다.
    await assertMachineInFactory(machineId, authenticatedUser.factoryId);

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
      machineId,
      updates,
      typeof body.change_reason === 'string' ? body.change_reason : null,
      authenticatedUser.userId
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

// DELETE /api/admin/machines/[machineId] - 설비 비활성화 (관리자 전용)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  try {
    const { machineId } = await params;
    const authenticatedUser = await requireFactoryUser(request, ['admin', 'engineer']);

    // 남의 공장 설비는 이 공장에서 **없는 것**이다. factory_id 는 바뀌지 않는 값이라
    // 사전 확인과 쓰기 사이에 틈이 생기지 않는다 (assertMachineInFactory 주석 참고).
    await assertMachineInFactory(machineId, authenticatedUser.factoryId);

    // 생산·비가동·상태 이력 보존을 위해 물리 삭제하지 않는다.
    // 비활성화도 설비 쓰기이므로 PUT 과 같은 apply_machine_update 를 거친다 — 그래야 설비 잠금
    // (advisory → FOR UPDATE)을 잡는다. 이전의 직접 UPDATE 는 잠금 없이 쓰여, Layout 확정·
    // andon·정정 RPC 가 잠금 아래에서 판단한 직후 설비가 꺼질 수 있었다 (2026-09-28 감사 후속).
    // is_active 만 바꾸는 호출은 상태가 안 바뀌므로 이미 비활성인 설비를 다시 눌러도 성공한다.
    await applyMachineUpdate(machineId, { is_active: false }, 'deactivated', authenticatedUser.userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    const authMapped = authErrorResponse(error);
    if (authMapped) return authMapped;

    const mapped = machineUpdateErrorResponse(error);
    if (mapped) return mapped;

    console.error('Error deleting machine:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete machine' }, { status: 500 });
  }
}
