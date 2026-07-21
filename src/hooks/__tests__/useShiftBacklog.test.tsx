import { renderHook, waitFor } from '@testing-library/react';
import { useShiftBacklog } from '../useShiftBacklog';
const mockAuthFetch = jest.fn();
jest.mock('@/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => mockAuthFetch(...a) }));

describe('useShiftBacklog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pending 을 closePending/defectPending 으로 노출한다', async () => {
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({
      close_pending: [{ date: '2026-07-17', shift: 'B' }],
      defect_pending: [{ date: '2026-07-17', shift: 'A', record_id: 'rA' }],
    }) });
    const { result } = renderHook(() => useShiftBacklog('m1'));
    await waitFor(() => expect(result.current.closePending).toHaveLength(1));
    expect(result.current.defectPending[0].record_id).toBe('rA');
  });

  it('machineId 없으면 조회 안 함', () => {
    renderHook(() => useShiftBacklog(null));
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });
});
