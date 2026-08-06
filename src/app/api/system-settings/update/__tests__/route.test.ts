jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockGetUser = jest.fn();
const mockSelect = jest.fn();
const mockSingle = jest.fn();
const mockRpc = jest.fn();

const profileQuery = {
  select: mockSelect,
  eq: jest.fn(),
  single: mockSingle,
};
mockSelect.mockReturnValue(profileQuery);
profileQuery.eq.mockReturnValue(profileQuery);

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn(() => profileQuery),
    rpc: mockRpc,
  })),
}));

import { POST } from '../route';

describe('POST /api/system-settings/update', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    mockSelect.mockReturnValue(profileQuery);
    profileQuery.eq.mockReturnValue(profileQuery);
    mockGetUser.mockResolvedValue({ data: { user: { id: 'inactive-admin' } }, error: null });
    mockSingle.mockResolvedValue({
      data: { role: 'admin', is_active: false },
      error: null,
    });
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
    expect(mockSelect).toHaveBeenCalledWith('role, is_active');
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
    mockSelect.mockReturnValue(profileQuery);
    profileQuery.eq.mockReturnValue(profileQuery);
    mockGetUser.mockResolvedValue({ data: { user: { id: 'active-admin' } }, error: null });
    mockSingle.mockResolvedValue({ data: { role: 'admin', is_active: true }, error: null });
    mockRpc.mockResolvedValue({ data: { ok: true, updated: 1 }, error: null });
  });

  it('계약에 있는 단건 저장은 그대로 통과한다', async () => {
    const response = await adminRequest({
      category: 'shift',
      setting_key: 'shift_a_start',
      setting_value: '08:00',
    });

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('update_system_setting', expect.objectContaining({
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
    expect(mockRpc).toHaveBeenCalledWith('update_system_settings_batch', expect.objectContaining({
      p_updates: [
        { category: 'shift', setting_key: 'break_time_minutes', setting_value: '110' },
        { category: 'display', setting_key: 'compact_mode', setting_value: 'true' },
      ],
    }));
  });

  it('계약 검사보다 인가가 먼저다 — 인증 없이 키 목록을 훑을 수 없다', async () => {
    // 계약 위반 사유는 "어떤 키가 존재하는가"를 알려준다. 인가 앞에서 검사하면 401/400 차이만
    // 으로 설정 키를 열거할 수 있게 된다.
    const response = await POST({
      headers: new Headers(),
      json: async () => ({ category: 'ui', setting_key: 'language', setting_value: 'ko' }),
    } as never);

    expect(response.status).toBe(401);
  });
});
