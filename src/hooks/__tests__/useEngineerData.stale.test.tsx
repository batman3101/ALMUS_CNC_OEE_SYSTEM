import { renderHook, waitFor } from '@testing-library/react';
import { useEngineerData } from '../useEngineerData';
import { fetchJsonDeduped } from '@/lib/requestCache';

jest.mock('@/lib/requestCache', () => ({ fetchJsonDeduped: jest.fn() }));
jest.mock('@/lib/authFetch', () => ({
  authFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

const mockFetchJsonDeduped = fetchJsonDeduped as jest.MockedFunction<typeof fetchJsonDeduped>;

const okJson = (payload: unknown) => Promise.resolve({
  ok: true,
  json: () => Promise.resolve(payload),
} as Response);

describe('useEngineerData stale filter protection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchJsonDeduped.mockResolvedValue({
      summary: { overall_performance: {
        avg_oee: 0.8, avg_availability: 0.9, avg_performance: 0.9, avg_quality: 0.99,
        total_output_qty: 10, total_good_qty: 10, total_defect_qty: 0,
      } },
      trends: { daily: [{
        date: '2026-07-01', avg_oee: 0.8, avg_availability: 0.9,
        avg_performance: 0.9, avg_quality: 0.99, total_output: 10,
        total_good_qty: 10, defect_rate: 0,
      }] },
    });
    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const value = String(url);
      if (value.startsWith('/api/downtime-analysis')) {
        return okJson({
          downtime_by_cause: [{ state: 'MAINTENANCE', occurrence_count: 1, total_duration: 10, percentage: 100 }],
          machine_analysis: [{ machine_id: 'm1', total_downtime: 10, downtime_events: 1 }],
        });
      }
      return okJson({
        trends: { daily: [{ date: '2026-07-01', total_output: 10, total_defects: 0, defect_rate: 0, avg_quality: 100 }] },
      });
    }) as jest.Mock;
  });

  it('clears previous filter data and exposes the new request error', async () => {
    const { result, rerender } = renderHook(
      ({ range }) => useEngineerData('month', undefined, range),
      { initialProps: { range: ['2026-07-01', '2026-07-01'] as [string, string] } }
    );

    await waitFor(() => expect(result.current.oeeData).toHaveLength(1));
    expect(result.current.productionData).toHaveLength(1);

    mockFetchJsonDeduped.mockRejectedValueOnce(new Error('new filter failed'));
    (global.fetch as jest.Mock).mockRejectedValue(new Error('new filter failed'));
    rerender({ range: ['2026-07-02', '2026-07-02'] });

    await waitFor(() => expect(result.current.error).toContain('new filter failed'));
    expect(result.current.oeeData).toEqual([]);
    expect(result.current.downtimeData).toEqual([]);
    expect(result.current.productionData).toEqual([]);
    expect(result.current.machineDowntime).toEqual({});
  });
});
