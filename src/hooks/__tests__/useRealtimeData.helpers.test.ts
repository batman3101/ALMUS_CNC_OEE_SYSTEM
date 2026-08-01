jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/authFetch', () => ({
  authFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

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

  /**
   * 2026-07-31 계약 변경.
   *
   * 예전에는 운영자의 담당 설비 배열을 받아 **설비마다 한 번씩** 요청했다
   * (`machine_id=machine-1`, `machine_id=machine-2`, …). `/api/oee-data` 가 운영자에게
   * machine_id 를 필수로 요구했기 때문이다. 그런데 이 프로젝트의 운영자는 전원 800대를
   * 배정받아 **800번의 순차 요청**이 됐고, 운영자 대시보드가 사실상 뜨지 않았다.
   *
   * 이제 라우트가 담당 설비로 직접 좁힌다. 호출자는 스코프를 모른다 — 그러므로 이 검사는
   * "요청이 한 벌인가"와 "스코프를 클라이언트가 다시 붙이지 않는가"를 함께 본다.
   */
  it('스코프는 서버가 건다 — 설비별로 나눠 부르지 않는다', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        oee_data: [],
        pagination: { returned: 0, total: 0, has_more: false }
      })
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchAllRecentProductionRecords();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).not.toContain('machine_id');
    // 담당 설비 스코프에서는 통계 RPC 가 설비를 하나만 받아 계산할 수 없다(라우트가
    // 400 으로 거절한다). 이 함수는 통계를 쓰지 않으므로 애초에 요청하지 않는다.
    expect(url).toContain('include_statistics=false');
  });
});
