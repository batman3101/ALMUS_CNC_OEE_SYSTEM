import {
  calculateChronologicalTrend,
  isoWeek,
  isValidDateOnly,
  sortPeriodsChronologically,
} from '../aggregationRules';

describe('BUG-011 aggregated OEE rules', () => {
  it('validates real calendar dates', () => {
    expect(isValidDateOnly('2026-07-15')).toBe(true);
    expect(isValidDateOnly('2026-02-30')).toBe(false);
    expect(isValidDateOnly('07/15/2026')).toBe(false);
  });

  it('uses ISO week-year across the calendar year boundary', () => {
    expect(isoWeek('2021-01-01')).toEqual({ key: '2020-W53', label: '2020년 53주' });
    expect(isoWeek('2021-01-04')).toEqual({ key: '2021-W01', label: '2021년 1주' });
  });

  it('reports rising and falling trends with chronological halves', () => {
    const points = [
      { period: '2026-01-04', oee: 0.8, availability: 0.8, performance: 0.8, quality: 0.8 },
      { period: '2026-01-03', oee: 0.6, availability: 0.6, performance: 0.6, quality: 0.6 },
      { period: '2026-01-02', oee: 0.4, availability: 0.4, performance: 0.4, quality: 0.4 },
      { period: '2026-01-01', oee: 0.2, availability: 0.2, performance: 0.2, quality: 0.2 },
    ];
    expect(calculateChronologicalTrend(points, 'oee')).toBeCloseTo(133.3333);
    expect(calculateChronologicalTrend([...points].reverse().map((p, i) => ({ ...p, oee: 0.8 - i * 0.2 })), 'oee')).toBeLessThan(0);
  });

  it('returns chart periods in chronological order', () => {
    expect(sortPeriodsChronologically([
      { period: '2026-07-15' },
      { period: '2026-04-01' },
      { period: '2026-06-30' },
    ])).toEqual([
      { period: '2026-04-01' },
      { period: '2026-06-30' },
      { period: '2026-07-15' },
    ]);
  });
});
