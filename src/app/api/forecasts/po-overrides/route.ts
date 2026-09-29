import { NextRequest, NextResponse } from 'next/server';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { applyPoOverride, PoOverrideError, revertPoOverride } from '@/lib/forecast/poOverrideStore';
import { parsePoQuantity } from '@/lib/forecast/poOverrides';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'private, no-store' };

/** A calendar date that really exists (2026-02-30 is not one). */
function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Body shared by PUT and DELETE. Anything else is a 400 — the request is never "fixed up". */
async function readTarget(request: NextRequest): Promise<{ body: Record<string, unknown>; submissionId: string; sourceRow: number; date: string }> {
  let body: unknown;
  try { body = await request.json(); } catch { throw new PoOverrideError(400, 'invalid_request'); }
  if (!body || typeof body !== 'object') throw new PoOverrideError(400, 'invalid_request');
  const b = body as Record<string, unknown>;
  const { submissionId, sourceRow, date } = b;
  if (typeof submissionId !== 'string' || !UUID.test(submissionId)) throw new PoOverrideError(400, 'invalid_request');
  if (typeof sourceRow !== 'number' || !Number.isSafeInteger(sourceRow) || sourceRow < 1) throw new PoOverrideError(400, 'invalid_request');
  if (!isDate(date)) throw new PoOverrideError(400, 'invalid_request');
  return { body: b, submissionId, sourceRow, date };
}

function failure(error: unknown, fallbackCode: string) {
  const authError = apiAuthErrorResponse(error);
  if (authError) return authError;
  if (error instanceof PoOverrideError) return NextResponse.json({ success: false, code: error.code }, { status: error.status });
  return NextResponse.json({ success: false, code: fallbackCode }, { status: 500 });
}

/**
 * 실제 PO 수량 적용 (사용자 요청 2026-09-29). Forecast 접수본의 (원본 행, 날짜) 한 칸에 수정값을 기록한다.
 * 화면이 본 접수 번호(submissionId)를 함께 보낸다 — 그사이 새 Forecast 가 접수됐으면 409 submission_changed.
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    const { body, submissionId, sourceRow, date } = await readTarget(request);
    const quantity = parsePoQuantity(body.quantity);
    if (quantity === null) throw new PoOverrideError(400, 'invalid_request');
    const result = await applyPoOverride({ id: user.factoryId }, user.userId, { submissionId, sourceRow, date, quantity });
    return NextResponse.json({ success: true, po: { quantity: result.quantity, updatedAt: result.updatedAt }, unchanged: result.unchanged }, { headers: NO_STORE });
  } catch (error) {
    return failure(error, 'po_save_failed');
  }
}

/** 실제 PO 수량 원복: 그 칸의 수정값을 지우고 Forecast 원본 값으로 되돌린다(이력은 남는다). */
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    const { submissionId, sourceRow, date } = await readTarget(request);
    const result = await revertPoOverride({ id: user.factoryId }, user.userId, { submissionId, sourceRow, date });
    return NextResponse.json({ success: true, reverted: result.reverted }, { headers: NO_STORE });
  } catch (error) {
    return failure(error, 'po_save_failed');
  }
}
