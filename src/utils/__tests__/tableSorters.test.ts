import {
  compareByRank,
  compareDate,
  compareNullableNumber,
  compareText
} from '../tableSorters';

/**
 * 정렬 비교 함수의 계약을 고정한다.
 *
 * 가장 중요한 성질은 **값이 없는 행은 방향과 무관하게 맨 뒤**라는 것이다.
 * antd 는 내림차순에서 비교 결과를 뒤집으므로, 그 성질은 비교 함수가
 * `sortOrder` 를 보고 스스로 부호를 뒤집어야만 성립한다.
 */

/** antd 가 실제로 하는 일: 내림차순이면 비교 결과를 뒤집는다. */
const sortLike = <T>(
  rows: readonly T[],
  sorter: (a: T, b: T, order: 'ascend' | 'descend') => number,
  order: 'ascend' | 'descend'
): T[] =>
  [...rows].sort((a, b) => {
    const result = sorter(a, b, order);
    return order === 'descend' ? -result : result;
  });

describe('compareNullableNumber', () => {
  it('숫자를 오름차순으로 비교한다', () => {
    expect(compareNullableNumber(1, 2, 'ascend')).toBeLessThan(0);
    expect(compareNullableNumber(2, 1, 'ascend')).toBeGreaterThan(0);
    expect(compareNullableNumber(2, 2, 'ascend')).toBe(0);
  });

  it('null 은 오름차순에서 맨 뒤로 간다', () => {
    const rows = [{ v: 0.3 }, { v: null }, { v: 0.9 }];
    expect(sortLike(rows, (a, b, o) => compareNullableNumber(a.v, b.v, o), 'ascend'))
      .toEqual([{ v: 0.3 }, { v: 0.9 }, { v: null }]);
  });

  it('null 은 내림차순에서도 맨 뒤로 간다 — 이것이 이 모듈의 존재 이유다', () => {
    const rows = [{ v: 0.3 }, { v: null }, { v: 0.9 }];
    expect(sortLike(rows, (a, b, o) => compareNullableNumber(a.v, b.v, o), 'descend'))
      .toEqual([{ v: 0.9 }, { v: 0.3 }, { v: null }]);
  });

  it('null 을 0 으로 취급하지 않는다', () => {
    // 0 은 실제로 측정된 값이므로 null 보다 앞이다. 둘을 같게 보면
    // "OEE 0%" 인 설비와 "데이터 없음" 인 설비가 뒤섞인다.
    expect(compareNullableNumber(0, null, 'ascend')).toBeLessThan(0);
    expect(compareNullableNumber(0, null, 'descend')).toBeGreaterThan(0);
  });

  it('NaN 은 값 없음과 같게 다룬다', () => {
    expect(compareNullableNumber(NaN, 5, 'ascend')).toBeGreaterThan(0);
    expect(compareNullableNumber(NaN, undefined, 'ascend')).toBe(0);
  });

  it('음수도 정상 값이다', () => {
    expect(compareNullableNumber(-5, 0, 'ascend')).toBeLessThan(0);
  });
});

describe('compareText', () => {
  it('한글을 사전순으로 비교한다', () => {
    expect(compareText('가공', '절삭', 'ascend')).toBeLessThan(0);
    expect(compareText('절삭', '가공', 'ascend')).toBeGreaterThan(0);
  });

  it('빈 문자열과 null 은 방향과 무관하게 맨 뒤', () => {
    const rows = [{ s: 'B' }, { s: '' }, { s: 'A' }, { s: null }];
    expect(sortLike(rows, (a, b, o) => compareText(a.s, b.s, o), 'ascend').slice(0, 2))
      .toEqual([{ s: 'A' }, { s: 'B' }]);
    expect(sortLike(rows, (a, b, o) => compareText(a.s, b.s, o), 'descend').slice(0, 2))
      .toEqual([{ s: 'B' }, { s: 'A' }]);
  });
});

describe('compareDate', () => {
  it('ISO 문자열을 시간순으로 비교한다', () => {
    expect(compareDate('2026-08-01', '2026-08-02', 'ascend')).toBeLessThan(0);
    expect(compareDate('2026-08-02T09:00:00Z', '2026-08-02T08:00:00Z', 'ascend')).toBeGreaterThan(0);
  });

  it('파싱할 수 없는 값은 1970년이 아니라 "값 없음" 이다', () => {
    // new Date('없음').getTime() 은 NaN 이다. 이걸 0 으로 떨어뜨리면
    // 오름차순 맨 앞에 조용히 끼어든다.
    expect(compareDate('없음', '2026-08-01', 'ascend')).toBeGreaterThan(0);
    expect(compareDate('없음', '2026-08-01', 'descend')).toBeLessThan(0);
  });

  it('Date 객체와 epoch 밀리초도 받는다', () => {
    expect(compareDate(new Date('2026-08-01'), Date.parse('2026-08-02'), 'ascend')).toBeLessThan(0);
  });
});

describe('compareByRank', () => {
  const bySeverity = compareByRank(['ERROR', 'MAINTENANCE', 'NORMAL_OPERATION'] as const);

  it('가나다순이 아니라 준 순서대로 비교한다', () => {
    // 이름순이었다면 ERROR < MAINTENANCE < NORMAL 이 우연히 같지만,
    // 순서를 바꾸면 갈린다.
    expect(bySeverity('ERROR', 'NORMAL_OPERATION', 'ascend')).toBeLessThan(0);
    expect(bySeverity('MAINTENANCE', 'ERROR', 'ascend')).toBeGreaterThan(0);
  });

  it('목록에 없는 값과 null 은 맨 뒤', () => {
    const rows = [{ s: 'NORMAL_OPERATION' }, { s: 'UNKNOWN_STATE' }, { s: 'ERROR' }, { s: null }];
    const ascend = sortLike(rows, (a, b, o) => bySeverity(a.s, b.s, o), 'ascend');
    expect(ascend.slice(0, 2)).toEqual([{ s: 'ERROR' }, { s: 'NORMAL_OPERATION' }]);
    const descend = sortLike(rows, (a, b, o) => bySeverity(a.s, b.s, o), 'descend');
    expect(descend.slice(0, 2)).toEqual([{ s: 'NORMAL_OPERATION' }, { s: 'ERROR' }]);
  });
});
