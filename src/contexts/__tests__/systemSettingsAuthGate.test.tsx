import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * 시스템 설정은 **로그인이 끝난 뒤에만** 조회한다.
 *
 * 예전에는 마운트 즉시 조회했다. 그 시점에는 Supabase 세션 복원이 끝나지 않아 요청이
 * **익명 역할**로 나갔고, 2026-07-29 에 익명 권한을 회수한 뒤로 매번
 * `42501 permission denied for table system_settings` 가 콘솔에 찍혔다.
 * (실측: 같은 URL 이 익명 401 / 로그인 세션 200)
 *
 * 없는 권한으로 두드려 보고 실패를 기록하는 대신, 조회할 수 있게 된 뒤에 조회한다.
 */

const mockGetStructuredSettings = jest.fn();
const mockAuth = jest.fn();

jest.mock('@/lib/systemSettings', () => ({
  systemSettingsService: {
    getStructuredSettings: (...a: unknown[]) => mockGetStructuredSettings(...a),
  },
  mapDbKeyToCodeKey: (_c: string, k: string) => k,
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
}));

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuth(),
}));

import { SystemSettingsProvider, useSystemSettings } from '../SystemSettingsContext';

const Probe: React.FC = () => {
  const { isLoading } = useSystemSettings();
  return <div data-testid="loading">{String(isLoading)}</div>;
};

const renderWith = (auth: { user: unknown; loading: boolean }) => {
  mockAuth.mockReturnValue({ ...auth, error: null });
  return render(
    <SystemSettingsProvider>
      <Probe />
    </SystemSettingsProvider>
  );
};

describe('시스템 설정 조회 시점', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStructuredSettings.mockResolvedValue({ general: { company_name: 'ALMUS' } });
  });

  it('인증이 아직 확인 중이면 조회하지 않는다', async () => {
    renderWith({ user: null, loading: true });
    await waitFor(() => expect(screen.getByTestId('loading')).toBeInTheDocument());
    expect(mockGetStructuredSettings).not.toHaveBeenCalled();
  });

  /**
   * 위 검사만으로는 `authLoading` 가드가 살아 있는지 알 수 없다 — user 가 null 이라
   * 그 다음 분기에서도 어차피 조회하지 않기 때문이다(변이 검사로 확인했다).
   *
   * 가드가 실제로 결과를 바꾸는 경우는 **직전 세션의 user 가 남은 채 인증이 다시
   * 확인 중일 때**다. 그 순간의 세션은 유효하지 않을 수 있으므로, 판정이 끝나기 전에
   * 조회하면 다시 익명 요청이 될 수 있다.
   */
  it('직전 사용자가 남아 있어도 인증 확인 중이면 조회하지 않는다', async () => {
    renderWith({ user: { id: 'u1', role: 'operator' }, loading: true });
    await waitFor(() => expect(screen.getByTestId('loading')).toBeInTheDocument());
    expect(mockGetStructuredSettings).not.toHaveBeenCalled();
  });

  it('로그인하지 않았으면 조회하지 않는다 — 익명으로는 읽을 권한이 없다', async () => {
    renderWith({ user: null, loading: false });
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(mockGetStructuredSettings).not.toHaveBeenCalled();
  });

  it('로그인하지 않아도 로딩은 끝난다 — 로그인 화면이 스피너에 갇히면 안 된다', async () => {
    renderWith({ user: null, loading: false });
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
  });

  it('로그인한 뒤에 조회한다', async () => {
    renderWith({ user: { id: 'u1', role: 'operator' }, loading: false });
    await waitFor(() => expect(mockGetStructuredSettings).toHaveBeenCalledTimes(1));
  });
});
