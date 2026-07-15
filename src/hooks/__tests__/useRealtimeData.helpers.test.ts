jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import {
  applyRealtimeMachineLog,
  fetchAllRecentProductionRecords,
  retainRecentAndOpenMachineLogs
} from '../useRealtimeData';
import type { MachineLog } from '@/types';

const log = (id: number, open = false): MachineLog => ({
  log_id: `log-${id}`,
  machine_id: `machine-${id}`,
  state: 'NORMAL_OPERATION',
  start_time: new Date(2026, 0, 1, 0, id % 60).toISOString(),
  ...(open ? {} : { end_time: new Date(2026, 0, 1, 1, id % 60).toISOString() }),
  operator_id: 'operator-1',
  created_at: new Date(2026, 0, 1).toISOString()
});

describe('useRealtimeData helpers', () => {
  it('Realtime INSERT 후에도 최근 5000건과 제한 밖 열린 로그를 보존한다', () => {
    const initial = [
      ...Array.from({ length: 5000 }, (_, index) => log(index)),
      ...Array.from({ length: 800 }, (_, index) => log(6000 + index, true))
    ];
    const next = applyRealtimeMachineLog(initial, 'INSERT', log(9999));
    expect(next).toHaveLength(5800);
    expect(next[0].log_id).toBe('log-9999');
    expect(next.filter(item => !item.end_time)).toHaveLength(800);
  });

  it('초기 병합에서도 최근 제한 밖의 열린 로그를 모두 남긴다', () => {
    expect(retainRecentAndOpenMachineLogs([
      ...Array.from({ length: 5001 }, (_, index) => log(index)),
      log(7000, true)
    ])).toHaveLength(5001);
  });

  it('/api/oee-data의 has_more 페이지를 끝까지 수집한다', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        oee_data: [{ record_id: 'r1' }],
        pagination: { returned: 1, total: 2, has_more: true }
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        oee_data: [{ record_id: 'r2' }],
        pagination: { returned: 1, total: 2, has_more: false }
      }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchAllRecentProductionRecords()).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('offset=1');
    expect(String(fetchMock.mock.calls[1][0])).toContain('known_total=2');
  });
});
