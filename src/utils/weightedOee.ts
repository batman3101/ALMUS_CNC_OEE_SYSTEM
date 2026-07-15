export interface OEEAggregateTotals {
  totalPlannedRuntime: number;
  totalActualRuntime: number;
  totalIdealRuntime: number;
  totalOutput: number;
  totalDefects: number;
}
export interface WeightedOEEMetrics {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

const clampRatio = (numerator: number, denominator: number): number => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, numerator / denominator));
};

/**
 * 장기 기간 OEE를 레코드별 비율의 단순 평균이 아니라 누적 시간·수량으로 계산한다.
 * 교대 길이와 생산량이 다른 행을 동일한 가중치로 취급하는 왜곡을 방지한다.
 */
export function calculateWeightedOEE(totals: OEEAggregateTotals): WeightedOEEMetrics {
  const availability = clampRatio(totals.totalActualRuntime, totals.totalPlannedRuntime);
  const performance = clampRatio(totals.totalIdealRuntime, totals.totalActualRuntime);
  const quality = clampRatio(totals.totalOutput - totals.totalDefects, totals.totalOutput);

  return {
    availability,
    performance,
    quality,
    oee: availability * performance * quality,
  };
}
