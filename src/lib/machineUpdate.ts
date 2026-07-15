import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * 설비 갱신 공용 모듈 (서버 전용).
 *
 * 설비를 수정하는 경로가 두 개 있었고(/api/machines/[id], /api/admin/machines/[id]),
 * 그중 admin 경로만 `.update({ ...body })` 로 직접 쓰고 있었다. 그 결과:
 *   - 컬럼 화이트리스트가 없어 클라이언트가 보낸 아무 컬럼이나 쓰였고,
 *   - machine_status_history 가 남지 않았으며,
 *   - .select() 가 없어 존재하지 않는 ID 도 성공으로 응답했다.
 * 두 경로가 이 모듈 하나만 쓰도록 통일한다.
 */

// RPC 로 넘기는 필드. 여기에 없는 키는 DB 함수의 화이트리스트에서도 무시된다.
export type MachineUpdates = Partial<{
  name: string;
  location: string | null;
  equipment_type: string | null;
  is_active: boolean;
  current_state: string;
  production_model_id: string | null;
  current_process_id: string | null;
}>;

// 클라이언트가 보낼 수 있는 키의 화이트리스트 (id/created_at 등은 절대 받지 않는다)
const ALLOWED_KEYS = [
  'name',
  'location',
  'equipment_type',
  'is_active',
  'current_state',
  'production_model_id',
  'current_process_id'
] as const;

export interface ApplyMachineUpdateResult {
  machine: Record<string, unknown> | null;
  state_changed: boolean;
  duration_minutes: number | null;
}

export class MachineNotFoundError extends Error {}
export class InvalidMachineStateError extends Error {}
export class InvalidMachineUpdateError extends Error {}

/**
 * 요청 본문에서 허용된 키만 골라낸다. 값이 undefined 인 키는 제외되어 기존 값이 유지된다.
 */
export function pickMachineUpdates(body: Record<string, unknown>): MachineUpdates {
  const updates: MachineUpdates = {};

  for (const key of ALLOWED_KEYS) {
    if (body[key] === undefined) continue;

    switch (key) {
      case 'is_active':
        if (typeof body[key] !== 'boolean') {
          throw new InvalidMachineUpdateError('is_active must be a boolean');
        }
        updates.is_active = body[key];
        break;
      case 'name':
        if (typeof body[key] !== 'string' || body[key].trim().length === 0) {
          throw new InvalidMachineUpdateError('name must be a non-empty string');
        }
        updates.name = body[key].trim();
        break;
      case 'current_state':
        if (typeof body[key] !== 'string' || body[key].trim().length === 0) {
          throw new InvalidMachineUpdateError('current_state must be a non-empty string');
        }
        updates.current_state = body[key].trim();
        break;
      default:
        // location / equipment_type / production_model_id / current_process_id 는 null 허용
        if (body[key] !== null && (typeof body[key] !== 'string' || body[key].trim().length === 0)) {
          throw new InvalidMachineUpdateError(`${key} must be null or a non-empty string`);
        }
        updates[key] = (body[key] === null ? null : body[key].trim()) as never;
        break;
    }
  }

  return updates;
}

/**
 * 설비 정보/상태 변경을 apply_machine_update RPC 하나로 처리한다.
 * (열린 로그 닫기 -> 새 로그 -> 상태 이력 -> machines 갱신을 단일 트랜잭션으로 묶는다)
 */
export async function applyMachineUpdate(
  machineId: string,
  updates: MachineUpdates,
  changeReason: string | null,
  changedBy: string | null = null
): Promise<ApplyMachineUpdateResult> {
  const { data, error } = await supabaseAdmin.rpc('apply_machine_update', {
    p_machine_id: machineId,
    p_updates: updates,
    p_change_reason: changeReason,
    p_changed_by: changedBy
  });

  if (error) {
    if (error.message?.includes('MACHINE_NOT_FOUND')) {
      throw new MachineNotFoundError('Machine not found');
    }
    // machine_status enum 에 없는 값을 보낸 경우 (Postgres: invalid input value for enum)
    if (error.code === '22P02') {
      throw new InvalidMachineStateError(error.message);
    }
    throw new Error(error.message);
  }

  return data as unknown as ApplyMachineUpdateResult;
}

// 설비 갱신 예외를 HTTP 응답으로 변환. 해당 없으면 null 을 반환한다.
export function machineUpdateErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof MachineNotFoundError) {
    return NextResponse.json({ success: false, error: 'Machine not found' }, { status: 404 });
  }
  if (error instanceof InvalidMachineStateError) {
    return NextResponse.json(
      { success: false, error: 'Invalid machine state', message: error.message },
      { status: 400 }
    );
  }
  if (error instanceof InvalidMachineUpdateError) {
    return NextResponse.json(
      { success: false, error: 'Invalid machine update', message: error.message },
      { status: 400 }
    );
  }
  return null;
}
