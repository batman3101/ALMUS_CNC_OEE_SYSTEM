jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockRpc = jest.fn();
const mockRequireFactoryUser = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ rpc: mockRpc })),
}));

/**
 * 인가는 더 이상 이 라우트가 직접 하지 않는다.
 *
 * 예전에는 여기서 토큰을 뜯어 `user_profiles.role` 을 읽었다. 그 검사는 역할만 알고
 * **공장을 모른다** — 설정은 공장마다 다른 행이므로, 어느 행을 고칠지 정하지 못한 채
 * 쓰게 된다. 이제 `requireFactoryUser` 가 세션·역할·공장을 한 번에 확정한다.
 *
 * 검사 **지점**이 옮겨졌을 뿐 이 테스트가 지키려는 성질은 그대로다:
 *   - 비활성 관리자는 RPC 전에 거부된다 (requireFactoryUser 가 403 을 던진다)
 *   - 계약 위반은 RPC 전에 400
 *   - 인가가 계약 검사보다 먼저
 */
jest.mock('@/lib/factoryAuth', () => ({
  requireFactoryUser: (...args: unknown[]) => mockRequireFactoryUser(...args),
}));

class FakeAuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

jest.mock('@/lib/apiAuth', () => ({
  apiAuthErrorResponse: (error: unknown) =>
    error instanceof Error && 'status' in error
      ? {
          status: (error as { status: number }).status,
          json: async () => ({ success: false, error: error.message }),
        }
      : null,
}));

const FACTORY_ID = '00000000-0000-4000-8000-00000000a17e';
const activeAdmin = () =>
  mockRequireFactoryUser.mockResolvedValue({
    userId: 'active-admin',
    factoryId: FACTORY_ID,
    factoryCode: 'ALT',
    role: 'admin',
    assignedMachineIds: [],
    isGlobalAdmin: false,
  });

import { POST } from '../route';

describe('POST /api/system-settings/update', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    // 비활성 계정은 requireFactoryUser 안에서 403 이 된다 ('비활성화된 계정입니다').
    mockRequireFactoryUser.mockRejectedValue(new FakeAuthError('비활성화된 계정입니다', 403));
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it('rejects a deactivated administrator before the service-role RPC runs', async () => {
    const response = await POST({
      headers: new Headers({ Authorization: 'Bearer valid-token' }),
      json: async () => ({
        category: 'shift',
        setting_key: 'shift_a_start',
        setting_value: '08:00',
      }),
    } as never);

    expect(response.status).toBe(403);
    // 요점은 상태 코드가 아니라 **RPC 가 돌지 않았다**는 것이다. 거부가 쓰기보다 늦으면
    // 403 을 돌려주면서 이미 저장을 마친 상태가 된다.
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

/**
 * 2026-08-06 감사 5.2 회귀 검사 — 계약 밖 키·자료형·범위를 저장 전에 막는다.
 *
 * 이 라우트가 부르는 `update_system_setting` 은 **키가 없으면 새 행을 INSERT 한다.** 그래서
 * 오타 한 번이 영구 레거시 행이 되고, 응답은 성공이라 아무도 알아채지 못한다. 라이브에 쌓인
 * 계약 밖 활성 키 11개가 그렇게 생겼다. 검사 지점은 반드시 RPC **앞**이어야 한다 — 뒤에서
 * 거르면 행은 이미 만들어져 있다.
 */
describe('POST /api/system-settings/update — 설정 계약 검증', () => {
  const adminRequest = (body: unknown) => POST({
    headers: new Headers({ Authorization: 'Bearer valid-token' }),
    json: async () => body,
  } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    activeAdmin();
    mockRpc.mockResolvedValue({ data: { ok: true, updated: 1 }, error: null });
  });

  it('계약에 있는 단건 저장은 그대로 통과한다', async () => {
    const response = await adminRequest({
      category: 'shift',
      setting_key: 'shift_a_start',
      setting_value: '08:00',
    });

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('update_system_setting_scoped', expect.objectContaining({
      // 공장이 인자에 실려 있어야 한다. 빠지면 옛 함수처럼 (category, key) 만으로 찾게 되고,
      // 두 공장에 같은 키가 있을 때 어느 행이 바뀔지 보장이 없다.
      p_factory_id: FACTORY_ID,
      p_category: 'shift',
      p_key: 'shift_a_start',
    }));
  });

  it('계약 밖 키는 키 이름을 담아 400 으로 거부한다', async () => {
    const response = await adminRequest({
      category: 'shift',
      setting_key: 'shift_a_end',
      setting_value: '20:00',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('shift.shift_a_end'),
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('자료형이 다르면 400 으로 거부한다', async () => {
    const response = await adminRequest({
      category: 'shift',
      setting_key: 'break_time_minutes',
      setting_value: 'ninety',
    });

    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('범위를 벗어나면 400 으로 거부한다', async () => {
    const response = await adminRequest({
      category: 'notification',
      setting_key: 'alert_check_interval_seconds',
      setting_value: 100000,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('300'),
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('배치는 항목 하나만 어긋나도 전체를 거부한다', async () => {
    // 배치 RPC 자체가 all-or-nothing 이므로 검증도 같은 규칙이어야 한다. 어긋난 항목만
    // 빼고 보내면 관리자가 저장했다고 믿는 것과 DB 에 들어간 것이 달라진다.
    const response = await adminRequest({
      updates: [
        { category: 'shift', setting_key: 'shift_a_start', setting_value: '08:00' },
        { category: 'shift', setting_key: 'shift_b_start', setting_value: '20:00' },
        { category: 'shift', setting_key: 'break_time_minutes', setting_value: '9999' },
      ],
    });

    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('전선 위의 문자열 숫자는 통과한다 — RPC 의 기존 전달 형식을 유지한다', async () => {
    // 클라이언트는 값을 JSON.stringify 로 문자열화해 보내고 RPC 가 스스로 종류를 판별한다.
    // 검증이 이 표현을 거부하면 정상 저장이 전부 막힌다.
    const response = await adminRequest({
      updates: [
        { category: 'shift', setting_key: 'break_time_minutes', setting_value: '110' },
        { category: 'display', setting_key: 'compact_mode', setting_value: 'true' },
      ],
    });

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('update_system_settings_batch_scoped', expect.objectContaining({
      p_factory_id: FACTORY_ID,
      p_updates: [
        { category: 'shift', setting_key: 'break_time_minutes', setting_value: '110' },
        { category: 'display', setting_key: 'compact_mode', setting_value: 'true' },
      ],
    }));
  });

  it('계약 검사보다 인가가 먼저다 — 인증 없이 키 목록을 훑을 수 없다', async () => {
    // 계약 위반 사유는 "어떤 키가 존재하는가"를 알려준다. 인가 앞에서 검사하면 401/400 차이만
    // 으로 설정 키를 열거할 수 있게 된다.
    mockRequireFactoryUser.mockRejectedValue(new FakeAuthError('인증이 필요합니다', 401));
    const response = await POST({
      headers: new Headers(),
      json: async () => ({ category: 'ui', setting_key: 'language', setting_value: 'ko' }),
    } as never);

    expect(response.status).toBe(401);
  });
});
