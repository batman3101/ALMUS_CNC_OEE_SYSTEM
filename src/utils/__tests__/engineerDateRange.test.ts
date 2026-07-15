import { getInclusiveDateRange } from '../engineerDateRange';

describe('getInclusiveDateRange', () => {
  it.each([
    [7, '2026-03-25'],
    [30, '2026-03-02'],
    [90, '2026-01-01']
  ] as const)('오늘 포함 %i일을 반환한다', (days, start_date) => {
    expect(getInclusiveDateRange(days, new Date(2026, 2, 31))).toEqual({
      start_date,
      end_date: '2026-03-31'
    });
  });

  it('윤년 2월 경계를 로컬 달력 기준으로 계산한다', () => {
    expect(getInclusiveDateRange(7, new Date(2024, 2, 1))).toEqual({
      start_date: '2024-02-24',
      end_date: '2024-03-01'
    });
  });
});
