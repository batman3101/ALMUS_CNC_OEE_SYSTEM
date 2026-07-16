import { act, renderHook, waitFor } from '@testing-library/react';
import { useRealtimeProductionRecords } from '../useRealtimeProductionRecords';
import { collectOeeDataPages } from '@/lib/oeeDataPages';
import { authFetch } from '@/lib/authFetch';

const unsubscribe = jest.fn();
let mockRealtimeHandler: ((payload: Record<string, unknown>) => Promise<void>) | undefined;
const mockInsertedSingle = jest.fn();
const channel = {
  on: jest.fn(),
  subscribe: jest.fn(),
  unsubscribe,
};
channel.on.mockImplementation((
  _event: string,
  _filter: Record<string, unknown>,
  handler: (payload: Record<string, unknown>) => Promise<void>
) => {
  mockRealtimeHandler = handler;
  return channel;
});
channel.subscribe.mockImplementation((callback: (status: string) => void) => {
  callback('SUBSCRIBED');
  return channel;
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: jest.fn(() => channel),
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ single: mockInsertedSingle })),
      })),
    })),
  },
}));
jest.mock('@/lib/oeeDataPages', () => ({ collectOeeDataPages: jest.fn() }));
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));

const mockCollect = collectOeeDataPages as jest.MockedFunction<typeof collectOeeDataPages>;
const mockAuthFetch = authFetch as jest.MockedFunction<typeof authFetch>;
const statistics = {
  total_records: 2,
  avg_oee: 0.5,
  avg_availability: 0.5,
  avg_performance: 1,
  avg_quality: 1,
  total_output: 1,
  total_defect: 0,
  total_good: 1,
  total_planned_runtime: 10,
  total_actual_runtime: 5,
  total_ideal_runtime: 5,
  aggregation_method: 'runtime_output_weighted' as const,
  data_quality: { impossible_records: 0, avg_oee_excluding_impossible: 0.5, avg_quality_excluding_impossible: 1 },
  downtime_reporting: { unreported_records: 0, reported_records: 2, unreported_ratio: 0, avg_availability_reported: 0.5, avg_oee_reported: 0.5 },
};

describe('useRealtimeProductionRecords safe report loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollect.mockReset();
    mockAuthFetch.mockReset();
    mockInsertedSingle.mockReset();
    mockRealtimeHandler = undefined;
  });

  it('marks capped data as truncated and clears it when a new filter fails', async () => {
    mockCollect.mockResolvedValueOnce({
      records: [{
        record_id: 'r1', machine_id: 'm1', date: '2026-07-01', shift: 'A',
        planned_runtime: 10, actual_runtime: 5, ideal_runtime: 5, output_qty: 1,
        defect_qty: 0, availability: 0.5, performance: 1, quality: 1, oee: 0.5,
        downtime_minutes: 5, created_at: '2026-07-01T00:00:00Z',
      }],
      statistics,
      total: 2,
    });

    const { result, rerender } = renderHook(
      ({ start }) => useRealtimeProductionRecords({ filters: { dateRange: { start, end: start } }, limit: 1 }),
      { initialProps: { start: '2026-07-01' } }
    );

    await waitFor(() => expect(result.current.records).toHaveLength(1));
    expect(result.current.isTruncated).toBe(true);
    expect(result.current.totalRecords).toBe(2);

    mockCollect.mockRejectedValueOnce(new Error('page failed'));
    rerender({ start: '2026-07-02' });

    await waitFor(() => expect(result.current.error).toContain('page failed'));
    expect(result.current.records).toEqual([]);
    expect(result.current.isTruncated).toBe(false);
  });

  it('keeps the server-sorted latest window when an older matching record is inserted', async () => {
    const latestRecord = {
      record_id: 'r1', machine_id: 'm1', date: '2026-07-03', shift: 'A' as const,
      planned_runtime: 10, actual_runtime: 5, ideal_runtime: 5, output_qty: 1,
      defect_qty: 0, availability: 0.5, performance: 1, quality: 1, oee: 0.5,
      downtime_minutes: 5, created_at: '2026-07-03T00:00:00Z',
    };
    const secondLatestRecord = {
      ...latestRecord,
      record_id: 'r2', date: '2026-07-02', created_at: '2026-07-02T00:00:00Z',
    };
    const olderInsertedRecord = {
      ...latestRecord,
      record_id: 'r4', date: '2026-07-01', created_at: '2026-07-01T00:00:00Z',
    };
    mockCollect
      .mockResolvedValueOnce({
        records: [latestRecord, secondLatestRecord],
        statistics: { ...statistics, total_records: 3 },
        total: 3,
      })
      .mockResolvedValueOnce({
        records: [latestRecord, secondLatestRecord],
        statistics: { ...statistics, total_records: 4 },
        total: 4,
      });
    mockInsertedSingle.mockResolvedValueOnce({ data: olderInsertedRecord, error: null });

    const { result } = renderHook(() => useRealtimeProductionRecords({
      filters: { dateRange: { start: '2026-07-01', end: '2026-07-03' } },
      limit: 2,
    }));

    await waitFor(() => expect(result.current.records).toHaveLength(2));
    await waitFor(() => expect(mockRealtimeHandler).toBeDefined());

    await act(async () => {
      await mockRealtimeHandler?.({
        eventType: 'INSERT',
        new: olderInsertedRecord,
        old: null,
      });
    });

    expect(result.current.records.map(record => record.record_id)).toEqual(['r1', 'r2']);
    expect(result.current.totalRecords).toBe(4);
    expect(result.current.isTruncated).toBe(true);
    expect(mockCollect).toHaveBeenCalledTimes(2);
  });

  it('removes and recounts a visible record when an update moves it outside the active filter', async () => {
    const existingRecord = {
      record_id: 'r1', machine_id: 'm1', date: '2026-07-01', shift: 'A' as const,
      planned_runtime: 10, actual_runtime: 5, ideal_runtime: 5, output_qty: 1,
      defect_qty: 0, availability: 0.5, performance: 1, quality: 1, oee: 0.5,
      downtime_minutes: 5, created_at: '2026-07-01T00:00:00Z',
    };
    mockCollect
      .mockResolvedValueOnce({ records: [existingRecord], statistics, total: 1 })
      .mockResolvedValueOnce({ records: [], statistics: { ...statistics, total_records: 0 }, total: 0 });

    const { result } = renderHook(() => useRealtimeProductionRecords({
      filters: { dateRange: { start: '2026-07-01', end: '2026-07-01' } },
      limit: 2,
    }));

    await waitFor(() => expect(result.current.records).toHaveLength(1));
    await act(async () => {
      await mockRealtimeHandler?.({
        eventType: 'UPDATE',
        new: { ...existingRecord, date: '2026-07-02' },
        old: { record_id: 'r1' },
      });
    });

    expect(result.current.records).toEqual([]);
    expect(result.current.totalRecords).toBe(0);
    expect(result.current.isTruncated).toBe(false);
    expect(mockCollect).toHaveBeenCalledTimes(2);
  });

  it('loads and recounts a non-visible record when an update moves it into the active filter', async () => {
    const existingRecord = {
      record_id: 'r1', machine_id: 'm1', date: '2026-07-01', shift: 'A' as const,
      planned_runtime: 10, actual_runtime: 5, ideal_runtime: 5, output_qty: 1,
      defect_qty: 0, availability: 0.5, performance: 1, quality: 1, oee: 0.5,
      downtime_minutes: 5, created_at: '2026-07-01T00:00:00Z',
    };
    const enteringRecord = {
      ...existingRecord,
      record_id: 'r2',
      created_at: '2026-07-01T01:00:00Z',
    };
    mockCollect
      .mockResolvedValueOnce({ records: [existingRecord], statistics, total: 1 })
      .mockResolvedValueOnce({
        records: [enteringRecord, existingRecord],
        statistics: { ...statistics, total_records: 2 },
        total: 2,
      });

    const { result } = renderHook(() => useRealtimeProductionRecords({
      filters: { dateRange: { start: '2026-07-01', end: '2026-07-01' } },
      limit: 2,
    }));

    await waitFor(() => expect(result.current.records).toHaveLength(1));
    await act(async () => {
      await mockRealtimeHandler?.({
        eventType: 'UPDATE',
        new: enteringRecord,
        old: { record_id: 'r2' },
      });
    });

    expect(result.current.records.map(record => record.record_id)).toEqual(['r2', 'r1']);
    expect(result.current.totalRecords).toBe(2);
    expect(result.current.isTruncated).toBe(false);
    expect(mockCollect).toHaveBeenCalledTimes(2);
  });

  it('reconciles total metadata from the server when a delete targets a row outside a truncated window', async () => {
    const visibleRecord = {
      record_id: 'r1', machine_id: 'm1', date: '2026-07-01', shift: 'A' as const,
      planned_runtime: 10, actual_runtime: 5, ideal_runtime: 5, output_qty: 1,
      defect_qty: 0, availability: 0.5, performance: 1, quality: 1, oee: 0.5,
      downtime_minutes: 5, created_at: '2026-07-01T00:00:00Z',
    };
    mockCollect.mockResolvedValueOnce({ records: [visibleRecord], statistics, total: 2 });
    mockAuthFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ statistics: { ...statistics, total_records: 1 } }),
    } as Response);

    const { result } = renderHook(() => useRealtimeProductionRecords({
      filters: { dateRange: { start: '2026-07-01', end: '2026-07-01' } },
      limit: 1,
    }));

    await waitFor(() => expect(result.current.isTruncated).toBe(true));
    jest.useFakeTimers();
    try {
      await act(async () => {
        await mockRealtimeHandler?.({
          eventType: 'DELETE',
          new: null,
          old: { record_id: 'r2' },
        });
        jest.advanceTimersByTime(500);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.records.map(record => record.record_id)).toEqual(['r1']);
      expect(result.current.totalRecords).toBe(1);
      expect(result.current.isTruncated).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
