export interface OeePageMeta {
  limit: number;
  offset: number;
  returned: number;
  total: number;
  has_more: boolean;
}

export interface OeeDataPage<TRecord, TStatistics> {
  oee_data: TRecord[];
  statistics: TStatistics | null;
  pagination: OeePageMeta;
}

interface CollectPagesOptions<TRecord, TStatistics> {
  pageSize: number;
  maxRecords?: number;
  fetchPage: (
    offset: number,
    limit: number,
    includeStatistics: boolean,
    knownTotal?: number
  ) => Promise<OeeDataPage<TRecord, TStatistics>>;
}

/**
 * 안정 정렬된 OEE API 페이지를 요청 상한 또는 전체 건수까지 수집한다.
 * 첫 페이지에서만 전체 통계를 계산하고 이후 페이지는 그 total을 재사용한다.
 */
export async function collectOeeDataPages<TRecord, TStatistics>({
  pageSize,
  maxRecords,
  fetchPage,
}: CollectPagesOptions<TRecord, TStatistics>): Promise<{
  records: TRecord[];
  statistics: TStatistics | null;
  total: number;
}> {
  const targetCount = maxRecords ?? Number.POSITIVE_INFINITY;
  const records: TRecord[] = [];
  let offset = 0;
  let total = 0;
  let statistics: TStatistics | null = null;

  do {
    const remaining = targetCount - offset;
    const limit = Math.min(pageSize, Number.isFinite(remaining) ? remaining : pageSize);
    const page = await fetchPage(offset, limit, offset === 0, offset === 0 ? undefined : total);

    if (offset === 0) {
      statistics = page.statistics;
      total = page.pagination.total;
    }

    records.push(...page.oee_data);
    offset += page.pagination.returned;

    if (page.pagination.returned === 0) break;
  } while (offset < total && offset < targetCount);

  return { records, statistics, total };
}
