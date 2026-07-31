/**
 * 401 은 도메인 오류가 아니다 — 세션 문제다.
 *
 * 운영 로그(2026-07-31 확인)에서 09:03~09:07 사이 `/downtime`,
 * `/production-progress`, `/production-records/pending`, `/machines`,
 * `/auth/profile-admin` 이 **전부 401** 이었다(같은 24시간 동안 500 은 0건). 토큰이
 * 만료된 채 화면이 30초마다 폴링하고 있었던 것이다.
 *
 * 그런데 사용자가 본 것은 "비가동 내역을 불러오지 못했습니다" 였다. 각 컴포넌트가 401 을
 * 자기 도메인 언어로 옮겨 적었기 때문이다. 원인은 비가동이 아니라 로그인인데 화면은
 * 데이터가 깨진 것처럼 말했다.
 */

const mockGetSession = jest.fn();
const mockRefreshSession = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => mockGetSession(...a),
      refreshSession: (...a: unknown[]) => mockRefreshSession(...a),
    },
  },
}));

import { authFetch } from '../authFetch';
import {
  onSessionExpired,
  __resetSessionExpiryForTests,
} from '../sessionExpiry';

const session = (token: string) => ({ data: { session: { access_token: token } }, error: null });
const response = (status: number) => ({ status }) as Response;

describe('authFetch 의 401 처리', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetSessionExpiryForTests();
    mockGetSession.mockResolvedValue(session('token-1'));
    mockRefreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'no' } });
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('성공 응답은 그대로 돌려주고 만료를 알리지 않는다', async () => {
    const expired = jest.fn();
    onSessionExpired(expired);
    fetchMock.mockResolvedValue(response(200));

    await expect(authFetch('/api/machines')).resolves.toMatchObject({ status: 200 });
    expect(mockRefreshSession).not.toHaveBeenCalled();
    expect(expired).not.toHaveBeenCalled();
  });

  it('세션 토큰을 Authorization 헤더로 붙인다', async () => {
    fetchMock.mockResolvedValue(response(200));

    await authFetch('/api/machines');

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer token-1');
  });

  it('403 은 만료로 보지 않는다 — 권한 부족은 로그인 문제가 아니다', async () => {
    const expired = jest.fn();
    onSessionExpired(expired);
    fetchMock.mockResolvedValue(response(403));

    await expect(authFetch('/api/settings')).resolves.toMatchObject({ status: 403 });
    expect(mockRefreshSession).not.toHaveBeenCalled();
    expect(expired).not.toHaveBeenCalled();
  });

  it('401 이면 먼저 토큰 갱신을 시도하고, 성공하면 재요청해서 회복한다', async () => {
    const expired = jest.fn();
    onSessionExpired(expired);
    fetchMock.mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200));
    mockRefreshSession.mockResolvedValue(session('token-2'));
    mockGetSession
      .mockResolvedValueOnce(session('token-1'))
      .mockResolvedValueOnce(session('token-2'));

    await expect(authFetch('/api/machines')).resolves.toMatchObject({ status: 200 });

    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 회복했으면 사용자를 로그인 화면으로 보내면 안 된다.
    expect(expired).not.toHaveBeenCalled();
    // 재시도는 **갱신된** 토큰으로 나가야 한다. 옛 토큰으로 다시 보내면 또 401 이다.
    const retryHeaders = fetchMock.mock.calls[1][1].headers as Headers;
    expect(retryHeaders.get('Authorization')).toBe('Bearer token-2');
  });

  it('갱신해도 401 이면 세션 만료를 알린다', async () => {
    const expired = jest.fn();
    onSessionExpired(expired);
    fetchMock.mockResolvedValue(response(401));
    mockRefreshSession.mockResolvedValue(session('token-2'));

    await expect(authFetch('/api/machines')).resolves.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('갱신 자체가 실패해도 만료를 알린다 (재요청은 하지 않는다)', async () => {
    const expired = jest.fn();
    onSessionExpired(expired);
    fetchMock.mockResolvedValue(response(401));

    await authFetch('/api/machines');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  /**
   * 만료되면 진행 중이던 요청이 **동시에** 401 을 받는다 — 운영 로그에서 30초마다 3개씩
   * 나왔다. 그때마다 알리면 로그아웃 처리가 겹쳐 실행된다.
   */
  it('동시에 여러 요청이 401 이어도 한 번만 알린다', async () => {
    const expired = jest.fn();
    onSessionExpired(expired);
    fetchMock.mockResolvedValue(response(401));

    await Promise.all([
      authFetch('/api/machines'),
      authFetch('/api/production-progress'),
      authFetch('/api/production-records/pending'),
    ]);

    expect(expired).toHaveBeenCalledTimes(1);
  });
});
