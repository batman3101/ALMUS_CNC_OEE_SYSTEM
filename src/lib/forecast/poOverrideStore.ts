import { supabaseAdmin } from '@/lib/supabase-admin';
import { readAllRows } from '@/lib/supabasePaging';
import type { ForecastSourceRow } from '@/types/forecast';
import type { StoredPoOverride } from './poOverrides';

/**
 * 실제 PO 수정값의 서버 쪽 저장소 (사용자 요청 2026-09-29).
 *
 * 읽기는 접수 번호(submission_id)로 좁힌다 — 새 Forecast 를 접수하면 번호가 바뀌어 옛 수정값은 읽히지 않는다(초기화).
 * 쓰기는 DB 함수(apply/revert_forecast_po_override)만 거친다: 표 갱신 + 이력 추가가 한 트랜잭션이고, 접수가
 * 그사이 바뀌었으면 함수가 거부한다.
 */

/** 라우트가 상태 코드로 바꾸는 오류. `code` 는 화면 번역 키다(errors.<code>). */
export class PoOverrideError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 422, readonly code: string) {
    super(code);
    this.name = 'PoOverrideError';
  }
}

interface OverrideRow { source_row: number; work_date: string; quantity: number; updated_at: string }

/**
 * 접수 1건의 수정값을 **전부** 읽는다. 감사 PO-01(2026-09-29): 예전에는 limit(50,000) 에 닿을 때만 '잘림'으로 봤는데,
 * 서버 반환 상한(PostgREST max-rows)이 그보다 낮으면 잘린 결과를 정상으로 받아들였다 - 빠진 칸은 Forecast 원본으로
 * 계산되어 실제 PO 와 다른 수요로 필요 대수가 나온다. 이제 전체 개수(count: exact)와 모은 행 수를 맞춰 완전할 때만 돌려주고,
 * 확인하지 못하면 실패시킨다(화면은 저장본 조회 실패로 알린다). 정렬은 기본 키(행 번호·날짜)라 쪽 경계가 안정적이다.
 */
export async function loadPoOverrides(factoryId: string, submissionId: string): Promise<StoredPoOverride[]> {
  const rows = await readAllRows<OverrideRow>((from, to) => supabaseAdmin.from('forecast_po_overrides')
    .select('source_row, work_date, quantity, updated_at', { count: 'exact' })
    .eq('factory_id', factoryId).eq('submission_id', submissionId)
    .order('source_row', { ascending: true }).order('work_date', { ascending: true })
    .range(from, to), { keyOf: row => row.source_row + '|' + row.work_date });
  return rows.map(r => ({ sourceRow: r.source_row, date: r.work_date, quantity: r.quantity, updatedAt: r.updated_at }));
}

interface Target { submissionId: string; sourceRow: number; date: string }

/** DB 함수의 거부를 라우트 오류로 옮긴다. 알 수 없는 오류는 그대로 던져 500 이 되게 한다. */
function rpcFailure(error: { message?: string }): never {
  const message = error.message ?? '';
  if (message.includes('SUBMISSION_CHANGED')) throw new PoOverrideError(409, 'submission_changed');
  if (message.includes('INVALID_PO_QUANTITY')) throw new PoOverrideError(400, 'invalid_request');
  throw error;
}

export async function applyPoOverride(
  factory: { id: string }, actor: string, input: Target & { quantity: number },
): Promise<{ quantity: number; updatedAt: string; unchanged: boolean }> {
  const { data: submission, error: readError } = await supabaseAdmin.from('forecast_submissions')
    .select('submission_id, preview').eq('factory_id', factory.id).maybeSingle();
  if (readError) throw readError;
  if (!submission) throw new PoOverrideError(404, 'no_submission');
  if (submission.submission_id !== input.submissionId) throw new PoOverrideError(409, 'submission_changed');

  // 대상 행·날짜와 '수정 당시의 Forecast 값'은 저장된 접수본에서 서버가 읽는다 — 화면이 보낸 값을 믿지 않는다.
  const rows = (submission.preview as { rows: ForecastSourceRow[] }).rows;
  const row = rows.find(r => r.sourceRow === input.sourceRow);
  const cell = row?.quantities.find(q => q.date === input.date);
  if (!row || !cell) throw new PoOverrideError(404, 'po_target_not_found');
  // 시뮬레이션은 CNC1~CNC2 로 매핑된 행만 읽는다 — 그 밖의 행에 수정값을 두면 아무 효과 없이 남는다.
  if (!row.model || !row.processes.length) throw new PoOverrideError(422, 'po_row_unsupported');

  const { data, error } = await supabaseAdmin.rpc('apply_forecast_po_override', {
    p_factory_id: factory.id, p_submission_id: input.submissionId, p_actor: actor,
    p_source_row: input.sourceRow, p_work_date: input.date, p_model: row.model,
    p_quantity: input.quantity, p_forecast_quantity: cell.quantity, p_forecast_state: cell.state,
  });
  if (error) rpcFailure(error);
  const result = data as { quantity: number; unchanged?: boolean; updated_at: string };
  return { quantity: result.quantity, updatedAt: result.updated_at, unchanged: result.unchanged === true };
}

export async function revertPoOverride(factory: { id: string }, actor: string, input: Target): Promise<{ reverted: boolean }> {
  const { data, error } = await supabaseAdmin.rpc('revert_forecast_po_override', {
    p_factory_id: factory.id, p_submission_id: input.submissionId, p_actor: actor,
    p_source_row: input.sourceRow, p_work_date: input.date,
  });
  if (error) rpcFailure(error);
  return { reverted: (data as { reverted: boolean }).reverted === true };
}
