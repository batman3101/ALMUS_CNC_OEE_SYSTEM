import { act, renderHook, waitFor } from '@testing-library/react';
import { useRealtimeProgress } from '../useRealtimeProgress';

const mockAuthFetch = jest.fn();
jest.mock('@/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => mockAuthFetch(...a) }));

/** 수동으로 resolve 할 수 있는 지연 프로미스. 응답 도착 순서를 테스트가 정한다. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const okResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

describe('useRealtimeProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthFetch.mockResolvedValue(okResponse({
      last_report: { shift_output_qty: 60, reported_at: '2026-07-17T09:30:00+07:00' },
      downtime_minutes: 0,
      tact_time_seconds: 72,
      break_config_matches: true,
    }));
  });

  it('마지막 보고·비가동·tact 를 가져온다', async () => {
    const { result } = renderHook(() =>
      useRealtimeProgress({ machineId: 'm1', date: '2026-07-17', shift: 'A' })
    );

    await waitFor(() => expect(result.current.lastReportedQty).toBe(60));
    expect(result.current.lastReportedAt).toBe('2026-07-17T09:30:00+07:00');
    expect(result.current.downtimeMinutes).toBe(0);
    expect(result.current.tactTimeSeconds).toBe(72);
    expect(result.current.breakConfigMatches).toBe(true);
    expect(result.current.error).toBeNull();
  });

  // 서버가 휴식 설정 불일치를 알리면 그대로 전달해야 한다. 훅이 이걸 삼키면
  // 화면이 틀린 가동률을 그럴듯하게 띄운다.
  it('휴식 설정 불일치 신호를 그대로 전달한다', async () => {
    mockAuthFetch.mockResolvedValue(okResponse({
      last_report: null, downtime_minutes: 0, tact_time_seconds: 72,
      break_config_matches: false,
    }));

    const { result } = renderHook(() =>
      useRealtimeProgress({ machineId: 'm1', date: '2026-07-17', shift: 'A' })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.breakConfigMatches).toBe(false);
  });

  // 정정 2: 초기값이 이미 null/null/null/false 이므로, 실패만 보면 catch 의 리셋을 지워도
  // 테스트가 통과한다(공허). 먼저 성공시켜 값을 채운 뒤, refresh 로 실패시켜 null/false 로
  // "되돌아가는지"를 본다. 이래야 catch 블록의 리셋이 실제로 고정된다.
  it('성공으로 채운 뒤 조회에 실패하면 0 이 아니라 null 로 되돌린다', async () => {
    mockAuthFetch.mockResolvedValueOnce(okResponse({
      last_report: { shift_output_qty: 60, reported_at: '2026-07-17T09:30:00+07:00' },
      downtime_minutes: 5,
      tact_time_seconds: 72,
      break_config_matches: true,
    }));

    const { result } = renderHook(() =>
      useRealtimeProgress({ machineId: 'm1', date: '2026-07-17', shift: 'A' })
    );

    // 1차 성공: 상태가 숫자/true 로 채워진다.
    await waitFor(() => expect(result.current.lastReportedQty).toBe(60));
    expect(result.current.downtimeMinutes).toBe(5);
    expect(result.current.tactTimeSeconds).toBe(72);
    expect(result.current.breakConfigMatches).toBe(true);

    // 2차 실패: refresh 로 500 을 일으킨다.
    mockAuthFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as Response);
    await act(async () => { result.current.refresh(); });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    // 채워졌던 값들이 null 로 되돌아가야 한다. (0 이 아니라 null — "못 읽음"과 "0분"은 다르다)
    expect(result.current.lastReportedQty).toBeNull();
    expect(result.current.lastReportedAt).toBeNull();
    expect(result.current.downtimeMinutes).toBeNull();
    expect(result.current.tactTimeSeconds).toBeNull();
    // 조회에 실패했으면 휴식 설정이 맞는지도 모른다. 일치를 가정하면 안 된다.
    expect(result.current.breakConfigMatches).toBe(false);
  });

  it('machineId 가 없으면 조회하지 않는다', () => {
    renderHook(() => useRealtimeProgress({ machineId: null, date: '2026-07-17', shift: 'A' }));
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });

  // 정정 1(경쟁): machineId 가 빠르게 바뀌면 두 조회가 경쟁한다. 오래된(m1) 응답이
  // 나중에 도착하더라도 최신(m2) 화면을 덮으면 안 된다 — 나중 요청이 이긴다.
  it('오래된 응답이 나중에 도착해도 최신 요청 결과를 덮지 않는다', async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    mockAuthFetch.mockReset();
    mockAuthFetch.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

    const { result, rerender } = renderHook(
      ({ machineId }) => useRealtimeProgress({ machineId, date: '2026-07-17', shift: 'A' }),
      { initialProps: { machineId: 'm1' } }
    );

    // m2 로 전환 — 두 번째 조회가 뜬다.
    rerender({ machineId: 'm2' });
    expect(mockAuthFetch).toHaveBeenCalledTimes(2);

    // 최신(m2) 응답을 먼저 적용한다.
    await act(async () => {
      d2.resolve(okResponse({
        last_report: { shift_output_qty: 20, reported_at: '2026-07-17T10:00:00+07:00' },
        downtime_minutes: 2, tact_time_seconds: 72, break_config_matches: true,
      }));
    });
    await waitFor(() => expect(result.current.lastReportedQty).toBe(20));

    // 오래된(m1) 응답이 뒤늦게 도착한다 — 무시돼야 한다.
    await act(async () => {
      d1.resolve(okResponse({
        last_report: { shift_output_qty: 10, reported_at: '2026-07-17T09:00:00+07:00' },
        downtime_minutes: 9, tact_time_seconds: 99, break_config_matches: false,
      }));
      await d1.promise;
    });

    // 여전히 m2 값이어야 한다. 가드가 없으면 여기서 10/9/99 로 덮인다.
    expect(result.current.lastReportedQty).toBe(20);
    expect(result.current.downtimeMinutes).toBe(2);
    expect(result.current.tactTimeSeconds).toBe(72);
    expect(result.current.breakConfigMatches).toBe(true);
  });

  // 정정 1(언마운트): 조회 도중 언마운트되면 이후 어떤 상태 갱신/경고도 없어야 한다.
  //
  // React 19 는 언마운트된 컴포넌트의 setState 를 조용히 무시하므로(경고도 없음) console
  // 스파이만으로는 언마운트 가드가 사라져도 못 잡는다 — 실제로 변이 검증에서 안 죽었다.
  // 그래서 관측 가능한 지점을 쓴다: 언마운트 가드(reqRef.current++)가 있으면 authFetch
  // 응답 직후 토큰 가드가 먼저 return 하므로 res.json() 이 호출되지 않는다. 이 응답 본문
  // 파싱 여부로 "언마운트 후 이 요청이 무효화됐는가"를 관측한다.
  it('언마운트 후 응답이 도착하면 본문을 파싱하지도 상태를 갱신하지도 않는다', async () => {
    const jsonSpy = jest.fn(async () => ({
      last_report: { shift_output_qty: 60, reported_at: '2026-07-17T09:30:00+07:00' },
      downtime_minutes: 0, tact_time_seconds: 72, break_config_matches: true,
    }));
    const d = deferred<Response>();
    mockAuthFetch.mockReset();
    mockAuthFetch.mockReturnValueOnce(d.promise);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { unmount } = renderHook(() =>
      useRealtimeProgress({ machineId: 'm1', date: '2026-07-17', shift: 'A' })
    );

    // 조회가 진행 중인 상태에서 언마운트.
    unmount();

    // 언마운트 뒤 응답 도착.
    await act(async () => {
      d.resolve({ ok: true, json: jsonSpy } as unknown as Response);
      await d.promise;
    });

    // 언마운트로 무효화됐으니 본문을 파싱하지 않는다(=이후 setState 도 없다).
    expect(jsonSpy).not.toHaveBeenCalled();
    // React 가 삼키더라도, 애초에 setState 경로에 진입하지 않았음을 함께 확인한다.
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
