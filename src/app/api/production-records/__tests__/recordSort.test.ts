import {
  DEFAULT_SORT,
  InvalidSortError,
  buildSortSteps,
  compareBySortSteps,
  parseRecordSort,
  type SortStep
} from '../recordSort';

/**
 * 정렬 규격의 계약을 고정한다.
 *
 * 가장 중요한 것은 **전순서**다. 정렬은 페이지를 자르는 기준이므로, 두 행의 순서가
 * 결정되지 않는 경우가 하나라도 있으면 그 지점에서 행이 사라지거나 중복된다.
 */

const sortRows = <T extends Record<string, unknown>>(rows: readonly T[], steps: readonly SortStep[]): T[] =>
  [...rows].sort((a, b) => compareBySortSteps(a, b, steps));

describe('parseRecordSort', () => {
  it('파라미터가 없으면 기존 동작(최신 날짜 먼저)을 유지한다', () => {
    expect(parseRecordSort(null, null)).toEqual(DEFAULT_SORT);
    expect(DEFAULT_SORT).toEqual({ field: 'date', direction: 'desc' });
  });

  it('허용된 컬럼과 방향을 정규화한다', () => {
    expect(parseRecordSort('oee', 'asc')).toEqual({ field: 'oee', direction: 'asc' });
    expect(parseRecordSort('output_qty', null)).toEqual({ field: 'output_qty', direction: 'desc' });
  });

  it('허용 목록 밖의 컬럼은 조용히 무시하지 않고 거절한다', () => {
    // 조용히 기본 정렬로 흘리면 "정렬한 줄 알았는데 아니었다" 가 된다.
    expect(() => parseRecordSort('machine_name', 'asc')).toThrow(InvalidSortError);
    expect(() => parseRecordSort('oee.desc', null)).toThrow(InvalidSortError);
    expect(() => parseRecordSort('created_at', null)).toThrow(InvalidSortError);
  });

  it('잘못된 방향도 거절한다', () => {
    expect(() => parseRecordSort('oee', 'ascending')).toThrow(InvalidSortError);
    expect(() => parseRecordSort(null, 'asc')).toThrow(InvalidSortError);
  });
});

describe('buildSortSteps', () => {
  it('마지막 단계는 언제나 record_id — 전순서의 조건이다', () => {
    for (const field of ['date', 'shift', 'output_qty', 'defect_qty', 'oee'] as const) {
      const steps = buildSortSteps(field, 'asc');
      expect(steps[steps.length - 1].column).toBe('record_id');
    }
  });

  it('NULL 은 어느 방향이든 뒤로 보내도록 지시한다', () => {
    expect(buildSortSteps('oee', 'asc').every(s => s.nullsFirst === false)).toBe(true);
    expect(buildSortSteps('oee', 'desc').every(s => s.nullsFirst === false)).toBe(true);
  });

  it('date 로 정렬할 때는 date 를 두 번 넣지 않는다', () => {
    const columns = buildSortSteps('date', 'asc').map(s => s.column);
    expect(columns).toEqual(['date', 'record_id']);
  });
});

describe('compareBySortSteps', () => {
  const rows = [
    { record_id: 'aaaa1111-0000-0000-0000-000000000001', date: '2026-08-02', shift: 'A', output_qty: 100, defect_qty: 3, oee: 0.72 },
    { record_id: 'bbbb2222-0000-0000-0000-000000000002', date: '2026-08-01', shift: 'B', output_qty: 250, defect_qty: null, oee: null },
    { record_id: 'cccc3333-0000-0000-0000-000000000003', date: '2026-08-02', shift: 'B', output_qty: 50, defect_qty: 0, oee: 0.91 },
    { record_id: 'dddd4444-0000-0000-0000-000000000004', date: '2026-08-03', shift: 'A', output_qty: 100, defect_qty: 12, oee: 0.35 }
  ];

  it('기본 정렬은 최신 날짜 먼저, 동점은 record_id 내림차순', () => {
    const ordered = sortRows(rows, buildSortSteps('date', 'desc')).map(r => r.record_id[0]);
    // 08-03 → 08-02 두 건(record_id desc: c > a) → 08-01
    expect(ordered).toEqual(['d', 'c', 'a', 'b']);
  });

  it('숫자 컬럼을 오름/내림으로 정렬한다', () => {
    expect(sortRows(rows, buildSortSteps('output_qty', 'asc')).map(r => r.output_qty))
      .toEqual([50, 100, 100, 250]);
    expect(sortRows(rows, buildSortSteps('output_qty', 'desc')).map(r => r.output_qty))
      .toEqual([250, 100, 100, 50]);
  });

  it('동점인 수량은 최신 날짜가 먼저 온다 (안정적인 2차 기준)', () => {
    const tied = sortRows(rows, buildSortSteps('output_qty', 'asc'))
      .filter(r => r.output_qty === 100)
      .map(r => r.date);
    expect(tied).toEqual(['2026-08-03', '2026-08-02']);
  });

  it('OEE 미보고(null)는 오름차순에서 맨 뒤', () => {
    expect(sortRows(rows, buildSortSteps('oee', 'asc')).map(r => r.oee))
      .toEqual([0.35, 0.72, 0.91, null]);
  });

  it('OEE 미보고(null)는 내림차순에서도 맨 뒤 — 화면의 정렬 규칙과 같다', () => {
    // Postgres 의 DESC 기본값은 NULLS FIRST 라서, 이 성질은 `nullsFirst:false` 를
    // 명시해야만 성립한다. 명시를 빠뜨리면 "OEE 높은 순" 첫 화면이 미보고 행으로 찬다.
    expect(sortRows(rows, buildSortSteps('oee', 'desc')).map(r => r.oee))
      .toEqual([0.91, 0.72, 0.35, null]);
  });

  it('미검사 불량(null)도 방향과 무관하게 뒤', () => {
    expect(sortRows(rows, buildSortSteps('defect_qty', 'asc')).map(r => r.defect_qty))
      .toEqual([0, 3, 12, null]);
    expect(sortRows(rows, buildSortSteps('defect_qty', 'desc')).map(r => r.defect_qty))
      .toEqual([12, 3, 0, null]);
  });

  it('불량 0건 확정과 미검사를 같은 값으로 보지 않는다', () => {
    const steps = buildSortSteps('defect_qty', 'asc');
    const zero = { record_id: 'x', date: '2026-08-01', defect_qty: 0 };
    const unchecked = { record_id: 'y', date: '2026-08-01', defect_qty: null };
    expect(compareBySortSteps(zero, unchecked, steps)).toBeLessThan(0);
    expect(compareBySortSteps(unchecked, zero, steps)).toBeGreaterThan(0);
  });

  it('어떤 두 행도 동점이 아니다 — 전순서라야 페이지 경계가 안전하다', () => {
    for (const field of ['date', 'shift', 'output_qty', 'defect_qty', 'oee'] as const) {
      for (const direction of ['asc', 'desc'] as const) {
        const steps = buildSortSteps(field, direction);
        for (const a of rows) {
          for (const b of rows) {
            if (a.record_id === b.record_id) continue;
            expect(compareBySortSteps(a, b, steps)).not.toBe(0);
          }
        }
      }
    }
  });

  it('uuid 비교에 localeCompare 를 쓰지 않는다 (Postgres 의 바이트 순서와 맞춘다)', () => {
    // ICU 는 하이픈을 무시 가능한 문자로 다뤄 '0-b' 와 '0b-' 를 같게 볼 수 있다.
    // Postgres 의 uuid 비교는 바이트 순이므로 코드포인트 비교와 일치해야 한다.
    const steps = buildSortSteps('date', 'desc');
    const left = { record_id: '00000000-0000-0000-0000-0000000000b0', date: '2026-08-01' };
    const right = { record_id: '000000000-000-0000-0000-000000000b0'.replace('000000000-', '00000000-'), date: '2026-08-01' };
    // 같은 날짜 → record_id 내림차순. 문자열 비교가 결정한다.
    expect(compareBySortSteps(left, right, steps)).toBe(
      left.record_id > right.record_id ? -1 : left.record_id < right.record_id ? 1 : 0
    );
  });
});
