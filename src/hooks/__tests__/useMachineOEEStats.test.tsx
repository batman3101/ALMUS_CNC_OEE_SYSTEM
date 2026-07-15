import { act, renderHook, waitFor } from '@testing-library/react';
import { useMachineOEEStats } from '../useMachineOEEStats';

const ok = (machineId: string) => ({
  ok: true,
  json: async () => ({
    success: true,
    machines: [{ machine_id: machineId, avg_oee: 0.8 }]
  })
});

describe('useMachineOEEStats scope', () => {
  beforeEach(() => jest.clearAllMocks());

  it('A 성공 후 B 실패 시 A 통계를 숨긴다', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(ok('A'))
      .mockResolvedValueOnce({ ok: false, status: 500 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ machineId }) => useMachineOEEStats('week', machineId),
      { initialProps: { machineId: 'A' } }
    );
    await waitFor(() => expect(result.current.stats.A).toBeTruthy());

    rerender({ machineId: 'B' });
    await waitFor(() => expect(result.current.error).toBe('HTTP 500'));
    expect(result.current.stats).toEqual({});
  });

  it('A/B 요청 응답이 뒤집혀도 최신 B 통계만 노출한다', async () => {
    let resolveA!: (value: unknown) => void;
    let resolveB!: (value: unknown) => void;
    const requestA = new Promise(resolve => { resolveA = resolve; });
    const requestB = new Promise(resolve => { resolveB = resolve; });
    global.fetch = jest.fn()
      .mockReturnValueOnce(requestA)
      .mockReturnValueOnce(requestB) as unknown as typeof fetch;

    const { result, rerender } = renderHook(
      ({ machineId }) => useMachineOEEStats('week', machineId),
      { initialProps: { machineId: 'A' } }
    );
    rerender({ machineId: 'B' });

    await act(async () => { resolveB(ok('B')); });
    await waitFor(() => expect(result.current.stats.B).toBeTruthy());
    await act(async () => { resolveA(ok('A')); });
    expect(result.current.stats.A).toBeUndefined();
    expect(result.current.stats.B).toBeTruthy();
  });
});
