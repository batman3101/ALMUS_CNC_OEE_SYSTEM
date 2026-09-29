import type { ForecastQuantity, ForecastSourceRow } from '@/types/forecast';
import { countPoOverrides, effectiveQuantity, MAX_PO_QUANTITY, mergePoOverrides, parsePoQuantity, withPoOverride } from '../poOverrides';

const cell = (date: string, quantity: number | null, state: ForecastQuantity['state'] = quantity === null ? 'blank' : 'number'): ForecastQuantity =>
  ({ date, cell: `I${date.slice(-2)}`, quantity, state, formula: false, error: null });
const row = (sourceRow: number, model: string, quantities: ForecastQuantity[]): ForecastSourceRow => ({
  sourceRow, model, displayModel: model, vendor: 'ALMUS', processGroup: 'CNC', processLabel: 'CNC 1 ~ CNC 2', processes: ['CNC1', 'CNC2'], issues: [], quantities,
});

describe('parsePoQuantity — PO 수량은 0 이상의 정수(개)뿐이다', () => {
  it.each([[0, 0], [3500, 3500], ['4000', 4000], [' 12 ', 12], [MAX_PO_QUANTITY, MAX_PO_QUANTITY]])('%p → %p', (input, expected) => {
    expect(parsePoQuantity(input)).toBe(expected);
  });
  it.each([-1, 1.5, NaN, Infinity, MAX_PO_QUANTITY + 1, '', 'abc', '1e3', '-5', '3.5', '0x10', null, undefined, {}, [], true])('%p 은 받지 않는다(고쳐 쓰지 않는다)', input => {
    expect(parsePoQuantity(input)).toBeNull();
  });
});

describe('mergePoOverrides', () => {
  const rows = [
    row(15, 'ON 1', [cell('2026-10-05', 2800), cell('2026-10-06', 3500)]),
    row(16, 'H8 MAIN', [cell('2026-10-05', 9000)]),
  ];

  it('원본 행·날짜 칸에만 수정값을 붙이고 원본 수량은 그대로 둔다', () => {
    const merged = mergePoOverrides(rows, [{ sourceRow: 15, date: '2026-10-06', quantity: 4200, updatedAt: '2026-09-29T02:00:00Z' }]);
    expect(merged[0].quantities[1]).toMatchObject({ quantity: 3500, state: 'number', po: { quantity: 4200, updatedAt: '2026-09-29T02:00:00Z' } });
    expect(merged[0].quantities[0].po).toBeUndefined();
    expect(merged[1]).toBe(rows[1]);
  });

  it('수정값이 없으면 같은 배열을, 수정값이 없는 행은 같은 객체를 돌려준다(불필요한 재계산 방지)', () => {
    expect(mergePoOverrides(rows, [])).toBe(rows);
    expect(mergePoOverrides(rows, [{ sourceRow: 15, date: '2026-10-05', quantity: 1, updatedAt: 't' }])[1]).toBe(rows[1]);
  });

  it('없는 행·날짜를 가리키는 수정값은 버린다(접수본에 없는 칸을 만들지 않는다)', () => {
    const merged = mergePoOverrides(rows, [
      { sourceRow: 99, date: '2026-10-05', quantity: 1, updatedAt: 't' },
      { sourceRow: 15, date: '2026-12-31', quantity: 1, updatedAt: 't' },
    ]);
    expect(countPoOverrides(merged)).toBe(0);
  });

  it('입력을 바꾸지 않는다', () => {
    const before = JSON.stringify(rows);
    mergePoOverrides(rows, [{ sourceRow: 15, date: '2026-10-05', quantity: 1, updatedAt: 't' }]);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('withPoOverride (화면 상태 갱신)', () => {
  const rows = [row(15, 'ON 1', [cell('2026-10-05', 2800), cell('2026-10-06', 3500)]), row(16, 'H8', [cell('2026-10-05', 1)])];

  it('한 칸만 바꾸고 다른 행은 같은 객체로 둔다', () => {
    const next = withPoOverride(rows, 15, '2026-10-06', { quantity: 10, updatedAt: 't' });
    expect(next[0].quantities[1].po).toEqual({ quantity: 10, updatedAt: 't' });
    expect(next[0].quantities[0].po).toBeUndefined();
    expect(next[1]).toBe(rows[1]);
  });

  it('null 을 주면 수정값을 뺀다(원복)', () => {
    const applied = withPoOverride(rows, 15, '2026-10-06', { quantity: 10, updatedAt: 't' });
    expect(withPoOverride(applied, 15, '2026-10-06', null)[0].quantities[1].po).toBeNull();
    expect(countPoOverrides(withPoOverride(applied, 15, '2026-10-06', null))).toBe(0);
  });

  it('없는 행·날짜면 아무것도 바꾸지 않는다', () => {
    expect(withPoOverride(rows, 99, '2026-10-06', { quantity: 1, updatedAt: 't' })).toEqual(rows);
    expect(countPoOverrides(withPoOverride(rows, 15, '2027-01-01', { quantity: 1, updatedAt: 't' }))).toBe(0);
  });
});

describe('effectiveQuantity — 시뮬레이션이 한 칸에서 읽는 값', () => {
  const withPo = (q: ForecastQuantity, quantity: number): ForecastQuantity => ({ ...q, po: { quantity, updatedAt: 't' } });

  it('수정값이 있으면 수정값이 우선한다', () => {
    expect(effectiveQuantity(withPo(cell('2026-10-05', 3500), 4200))).toEqual({ state: 'number', quantity: 4200, po: true });
  });

  it('원본이 빈 칸·오류·읽을 수 없음이어도 수정값이 있으면 숫자로 읽는다', () => {
    for (const state of ['blank', 'error', 'missing_cache', 'invalid'] as const) {
      expect(effectiveQuantity(withPo(cell('2026-10-05', null, state), 700))).toEqual({ state: 'number', quantity: 700, po: true });
    }
  });

  it('0 도 유효한 PO 다(그날 납품이 없다) — 수정값이 없는 것으로 취급하지 않는다', () => {
    expect(effectiveQuantity(withPo(cell('2026-10-05', 3500), 0))).toEqual({ state: 'number', quantity: 0, po: true });
  });

  it('usePo 가 꺼져 있거나 수정값이 없으면 원본 그대로다', () => {
    expect(effectiveQuantity(withPo(cell('2026-10-05', 3500), 4200), false)).toEqual({ state: 'number', quantity: 3500, po: false });
    expect(effectiveQuantity(cell('2026-10-05', null, 'error'))).toEqual({ state: 'error', quantity: null, po: false });
    expect(effectiveQuantity({ ...cell('2026-10-05', 5), po: null })).toEqual({ state: 'number', quantity: 5, po: false });
  });
});
