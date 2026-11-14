import type { ForecastQuantity, ForecastSourceRow, ForecastValueState, PoOverride } from '@/types/forecast';

/**
 * 실제 PO 수정값 (사용자 요청 2026-09-29) — 서버와 화면이 같이 쓰는 순수 로직.
 *
 * 수정값은 접수한 Forecast 의 (원본 행, 날짜) 칸에 붙는다. 원본 `quantity` 는 바꾸지 않는다 — 시뮬레이션이 무엇을
 * 읽는지는 `effectiveQuantity` 한 곳이 정한다.
 */

/** 하루 PO 수량의 상한. DB 검사 제약(forecast_po_overrides.quantity)과 같은 값이어야 한다. */
export const MAX_PO_QUANTITY = 100_000_000;

/** PO 수량은 0 이상의 정수(개)다. 그렇지 않으면 null — 소수·음수·문자·범위 밖을 조용히 고쳐 쓰지 않는다. */
export function parsePoQuantity(value: unknown): number | null {
  let n = value;
  if (typeof n === 'string') {
    const text = n.trim();
    if (!/^\d+$/.test(text)) return null;
    n = Number(text);
  }
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > MAX_PO_QUANTITY) return null;
  return n;
}

/** 서버가 저장소에서 읽은 수정값 한 건. */
export interface StoredPoOverride { sourceRow: number; date: string; quantity: number; updatedAt: string }

const slot = (sourceRow: number, date: string) => `${sourceRow}|${date}`;

/** 접수본의 날짜 칸에 수정값을 붙인다. 수정값이 없는 행·칸은 (같은 객체로) 그대로 둔다. */
export function mergePoOverrides(rows: ForecastSourceRow[], overrides: readonly StoredPoOverride[]): ForecastSourceRow[] {
  if (!overrides.length) return rows;
  const bySlot = new Map(overrides.map(o => [slot(o.sourceRow, o.date), o]));
  return rows.map(row => {
    if (!row.quantities.some(q => bySlot.has(slot(row.sourceRow, q.date)))) return row;
    return {
      ...row,
      quantities: row.quantities.map(q => {
        const o = bySlot.get(slot(row.sourceRow, q.date));
        return o ? { ...q, po: { quantity: o.quantity, updatedAt: o.updatedAt } } : q;
      }),
    };
  });
}

/** 화면 상태용: 한 칸의 수정값을 넣거나(null 이면 빼고) 바뀐 행만 새 객체로 돌려준다. */
export function withPoOverride(rows: ForecastSourceRow[], sourceRow: number, date: string, po: PoOverride | null): ForecastSourceRow[] {
  return rows.map(row => {
    if (row.sourceRow !== sourceRow || !row.quantities.some(q => q.date === date)) return row;
    return { ...row, quantities: row.quantities.map(q => (q.date === date ? { ...q, po } : q)) };
  });
}

/** 수정값이 붙은 칸 수. */
export function countPoOverrides(rows: readonly ForecastSourceRow[]): number {
  return rows.reduce((sum, row) => sum + row.quantities.filter(q => q.po).length, 0);
}

/**
 * 시뮬레이션이 한 칸에서 읽는 값. 수정값이 있으면 그것이 우선하고 상태는 항상 숫자다 — 원본이 빈 칸·오류였어도
 * 사람이 확인한 PO 수량이 있으면 '읽을 수 없는 수요'가 아니다. `usePo = false` 면 수정값이 없는 것처럼 읽는다.
 */
export function effectiveQuantity(q: ForecastQuantity, usePo = true): { state: ForecastValueState; quantity: number | null; po: boolean } {
  if (usePo && q.po) return { state: 'number', quantity: q.po.quantity, po: true };
  return { state: q.state, quantity: q.quantity, po: false };
}
