const DEFAULT_DETAIL_LIMIT = 500;
const MAX_DETAIL_LIMIT = 1000;

/** 생산수량으로 가중한 품질률(0-100). */
export const calculateWeightedQualityPercent = (
  totalOutput: number,
  totalDefects: number
): number => totalOutput > 0
  ? (Math.max(0, totalOutput - totalDefects) / totalOutput) * 100
  : 0;

/** 상세 조회는 Supabase max_rows와 무관하게 명시적인 페이지 계약을 사용한다. */
export const parseDetailPagination = (searchParams: URLSearchParams): { limit: number; offset: number } => {
  const requestedLimit = Number.parseInt(searchParams.get('detail_limit') || '', 10);
  const requestedOffset = Number.parseInt(searchParams.get('detail_offset') || '', 10);

  return {
    limit: Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_DETAIL_LIMIT)
      : DEFAULT_DETAIL_LIMIT,
    offset: Number.isFinite(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0,
  };
};
