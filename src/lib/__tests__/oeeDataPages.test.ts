import { collectOeeDataPages, OeeDataPage } from '@/lib/oeeDataPages';

interface Row { id: number }
interface Stats { total_records: number }

function createFetcher(total: number) {
  const rows = Array.from({ length: total }, (_, id) => ({ id }));
  return jest.fn(async (
    offset: number,
    limit: number,
    includeStatistics: boolean,
    knownTotal?: number
  ): Promise<OeeDataPage<Row, Stats>> => {
    const pageRows = rows.slice(offset, offset + limit);
    const effectiveTotal = includeStatistics ? total : (knownTotal ?? 0);
    return {
      oee_data: pageRows,
      statistics: includeStatistics ? { total_records: total } : null,
      pagination: {
        limit,
        offset,
        returned: pageRows.length,
        total: effectiveTotal,
        has_more: offset + pageRows.length < effectiveTotal,
      },
    };
  });
}

describe('collectOeeDataPages', () => {
  it('1,001건을 페이지 경계의 중복이나 누락 없이 모두 수집한다', async () => {
    const fetchPage = createFetcher(1001);
    const result = await collectOeeDataPages({ pageSize: 1000, fetchPage });

    expect(result.records).toHaveLength(1001);
    expect(result.records.map(row => row.id)).toEqual(Array.from({ length: 1001 }, (_, id) => id));
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1]).toEqual([1000, 1000, false, 1001]);
  });

  it('50,001건도 전체 페이지를 따라가며 통계는 첫 페이지에서만 요청한다', async () => {
    const fetchPage = createFetcher(50001);
    const result = await collectOeeDataPages({ pageSize: 5000, fetchPage });

    expect(result.records).toHaveLength(50001);
    expect(new Set(result.records.map(row => row.id)).size).toBe(50001);
    expect(fetchPage).toHaveBeenCalledTimes(11);
    expect(fetchPage.mock.calls.filter(call => call[2] === true)).toHaveLength(1);
  });

  it('상한이 있으면 잘린 사실과 전체 total을 함께 보존한다', async () => {
    const fetchPage = createFetcher(50001);
    const result = await collectOeeDataPages({ pageSize: 5000, maxRecords: 15000, fetchPage });

    expect(result.records).toHaveLength(15000);
    expect(result.total).toBe(50001);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});
