export interface OEEAggregateTotals {
  reportedRecords: number;
  totalPlannedRuntime: number;
  totalActualRuntime: number;
  totalIdealRuntime: number;
  totalOutput: number;
  totalDefects: number;
}
export interface WeightedOEEMetrics {
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
}

const clampRatio = (numerator: number, denominator: number): number | null => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }

  return Math.min(1, Math.max(0, numerator / denominator));
};

/**
 * 장기 기간 OEE를 레코드별 비율의 단순 평균이 아니라 누적 시간·수량으로 계산한다.
 * 교대 길이와 생산량이 다른 행을 동일한 가중치로 취급하는 왜곡을 방지한다.
 */
export function calculateWeightedOEE(totals: OEEAggregateTotals): WeightedOEEMetrics {
  if (!Number.isFinite(totals.reportedRecords) || totals.reportedRecords <= 0) {
    return {
      availability: null,
      performance: null,
      quality: null,
      oee: null,
    };
  }

  const availability = totals.totalActualRuntime < 0
    ? null
    : clampRatio(totals.totalActualRuntime, totals.totalPlannedRuntime);
  const performance = totals.totalActualRuntime < 0 || totals.totalIdealRuntime < 0
    ? null
    : totals.totalActualRuntime === 0
      ? 0
      : clampRatio(totals.totalIdealRuntime, totals.totalActualRuntime);
  const quality = (
    totals.totalOutput < 0 ||
    totals.totalDefects < 0 ||
    totals.totalDefects > totals.totalOutput
  )
    ? null
    : totals.totalOutput === 0
      ? 0
      : clampRatio(totals.totalOutput - totals.totalDefects, totals.totalOutput);
  const oee = availability !== null && performance !== null && quality !== null
    ? availability * performance * quality
    : null;

  return {
    availability,
    performance,
    quality,
    oee,
  };
}
