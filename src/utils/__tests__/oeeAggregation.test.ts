import { calculateWeightedOEE } from '@/utils/weightedOee';

describe('calculateWeightedOEE', () => {
  it('누적 시간과 수량으로 장기 기간 OEE를 계산한다', () => {
    const metrics = calculateWeightedOEE({
      totalPlannedRuntime: 1000,
      totalActualRuntime: 800,
      totalIdealRuntime: 600,
      totalOutput: 1000,
      totalDefects: 50,
    });

    expect(metrics.availability).toBeCloseTo(0.8);
    expect(metrics.performance).toBeCloseTo(0.75);
    expect(metrics.quality).toBeCloseTo(0.95);
    expect(metrics.oee).toBeCloseTo(0.57);
  });

  it('0 분모와 비정상 누적값에서 NaN 또는 100% 초과를 만들지 않는다', () => {
    expect(calculateWeightedOEE({
      totalPlannedRuntime: 0,
      totalActualRuntime: 0,
      totalIdealRuntime: 100,
      totalOutput: 0,
      totalDefects: 10,
    })).toEqual({ availability: 0, performance: 0, quality: 0, oee: 0 });

    expect(calculateWeightedOEE({
      totalPlannedRuntime: 100,
      totalActualRuntime: 120,
      totalIdealRuntime: 240,
      totalOutput: 10,
      totalDefects: -5,
    })).toEqual({ availability: 1, performance: 1, quality: 1, oee: 1 });
  });
});
