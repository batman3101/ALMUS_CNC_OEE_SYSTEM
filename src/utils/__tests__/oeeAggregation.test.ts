import { calculateWeightedOEE } from '@/utils/weightedOee';

describe('calculateWeightedOEE', () => {
  it('누적 시간과 수량으로 장기 기간 OEE를 계산한다', () => {
    const metrics = calculateWeightedOEE({
      reportedRecords: 2,
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
      reportedRecords: 1,
      totalPlannedRuntime: 0,
      totalActualRuntime: 0,
      totalIdealRuntime: 100,
      totalOutput: 0,
      totalDefects: 10,
    })).toEqual({ availability: null, performance: 0, quality: null, oee: null });

    expect(calculateWeightedOEE({
      reportedRecords: 1,
      totalPlannedRuntime: 100,
      totalActualRuntime: 120,
      totalIdealRuntime: 240,
      totalOutput: 10,
      totalDefects: 0,
    })).toEqual({ availability: 1, performance: 1, quality: 1, oee: 1 });
  });

  it('음수 누적값과 생산량을 초과한 불량 수량을 정상 0점으로 숨기지 않는다', () => {
    expect(calculateWeightedOEE({
      reportedRecords: 1,
      totalPlannedRuntime: 100,
      totalActualRuntime: -1,
      totalIdealRuntime: 0,
      totalOutput: 10,
      totalDefects: 0,
    })).toEqual({ availability: null, performance: null, quality: 1, oee: null });

    expect(calculateWeightedOEE({
      reportedRecords: 1,
      totalPlannedRuntime: 100,
      totalActualRuntime: 50,
      totalIdealRuntime: 25,
      totalOutput: 10,
      totalDefects: 11,
    })).toEqual({ availability: 0.5, performance: 0.5, quality: null, oee: null });
  });

  it('보고 완료 표본이 없으면 누적값과 무관하게 계산 불가를 반환한다', () => {
    expect(calculateWeightedOEE({
      reportedRecords: 0,
      totalPlannedRuntime: 660,
      totalActualRuntime: 0,
      totalIdealRuntime: 0,
      totalOutput: 0,
      totalDefects: 0,
    })).toEqual({ availability: null, performance: null, quality: null, oee: null });
  });

  it('보고 완료된 무생산 교대는 실제 OEE 0으로 계산한다', () => {
    expect(calculateWeightedOEE({
      reportedRecords: 1,
      totalPlannedRuntime: 660,
      totalActualRuntime: 0,
      totalIdealRuntime: 0,
      totalOutput: 0,
      totalDefects: 0,
    })).toEqual({ availability: 0, performance: 0, quality: 0, oee: 0 });
  });
});
