import { renderHook, act } from '@testing-library/react';
import { useMachineDowntime } from '../useMachineDowntime';
const mockAuthFetch = jest.fn();
jest.mock('@/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => mockAuthFetch(...a) }));

describe('useMachineDowntime', () => {
  beforeEach(() => { jest.clearAllMocks(); mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, state: 'INSPECTION' }) }); });

  it('start(reason) 는 action=start·reason 을 POST 한다', async () => {
    const onDone = jest.fn();
    const { result } = renderHook(() => useMachineDowntime('m1', onDone));
    await act(async () => { await result.current.start('INSPECTION'); });
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(String(url)).toContain('/api/machines/m1/downtime');
    expect(JSON.parse((init as { body: string }).body)).toEqual({ action: 'start', reason: 'INSPECTION' });
    expect(onDone).toHaveBeenCalled();
  });

  it('resume 는 action=resume 을 POST 한다', async () => {
    const { result } = renderHook(() => useMachineDowntime('m1', jest.fn()));
    await act(async () => { await result.current.resume(); });
    expect(JSON.parse((mockAuthFetch.mock.calls[0][1] as { body: string }).body)).toEqual({ action: 'resume' });
  });
});
