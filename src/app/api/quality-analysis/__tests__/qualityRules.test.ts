jest.mock('next/server', () => ({
  NextResponse: { json: jest.fn() },
}));

jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {} }));

import {
  calculateWeightedQualityPercent,
  parseDetailPagination,
} from '../qualityRules';

describe('quality analysis aggregation rules', () => {
  it('weights quality by produced quantity instead of record count', () => {
    expect(calculateWeightedQualityPercent(101, 1)).toBeCloseTo(99.0099, 4);
    expect(calculateWeightedQualityPercent(0, 0)).toBe(0);
  });

  it('uses explicit bounded pagination for detail rows', () => {
    expect(parseDetailPagination(new URLSearchParams())).toEqual({ limit: 500, offset: 0 });
    expect(parseDetailPagination(new URLSearchParams('detail_limit=5000&detail_offset=1200')))
      .toEqual({ limit: 1000, offset: 1200 });
    expect(parseDetailPagination(new URLSearchParams('detail_limit=-1&detail_offset=-2')))
      .toEqual({ limit: 500, offset: 0 });
  });
});
