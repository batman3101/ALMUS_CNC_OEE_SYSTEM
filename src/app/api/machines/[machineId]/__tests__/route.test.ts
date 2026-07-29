jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const rpc = jest.fn();
const from = jest.fn();
const mockRequireUser = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  assertMachineAccess: jest.fn(),
  apiAuthErrorResponse: (error: unknown) =>
    error instanceof Error && error.message === 'unauthorized'
      ? { status: 401, json: async () => ({ error: 'unauthorized' }) }
      : null,
}));

// from() 은 호출을 기록하되 **정상적으로 동작하는** 체인을 돌려준다.
// 사전 조회가 되살아나도 크래시가 아니라 성공하게 두어야, "조회했다"는 사실 자체로
// 테스트가 실패한다. 크래시로 실패하면 다른 이유로도 실패해 무엇을 검증하는지 흐려진다.
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => {
      from(...args);
      const query: Record<string, unknown> = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: { id: 'machine-1', is_active: true }, error: null }),
      };
      return query;
    },
  },
}));

import { PATCH, PUT } from '../route';

const params = Promise.resolve({ machineId: 'machine-1' });
const patch = (body: unknown) =>
  PATCH({ json: async () => body } as never, { params } as never);

const okRpc = () => ({
  data: { machine: { id: 'machine-1', name: 'CNC-01' }, state_changed: true, duration_minutes: 3 },
  error: null,
});

describe('PATCH /api/machines/[machineId] — 비활성 판단이 잠금 안에 있다', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator' });
  });

  it('RPC 에 p_require_active: true 를 넘긴다', async () => {
    rpc.mockResolvedValue(okRpc());

    const response = await patch({ current_state: 'INSPECTION' });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'apply_machine_update',
      expect.objectContaining({ p_machine_id: 'machine-1', p_require_active: true })
    );
  });

  it('RPC 를 부르기 전에 machines 를 미리 조회하지 않는다', async () => {
    // 이것이 이 변경의 핵심이다. 사전 조회는 RPC 트랜잭션 **밖**이라 advisory lock 을 잡지 않는다.
    // 그 조회로 "활성이다"를 판단하면, 조회와 쓰기 사이에 설비가 비활성화돼도 쓰기가 진행된다.
    // 판단은 잠금을 잡은 RPC 안에서만 이뤄져야 하므로, 이 경로에는 사전 조회가 있으면 안 된다.
    rpc.mockResolvedValue(okRpc());

    await patch({ current_state: 'INSPECTION' });

    expect(from).not.toHaveBeenCalled();
  });

  it('비활성 설비는 409 로 거부한다 (RPC 가 잠금 안에서 판단한 결과)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '55000', message: 'MACHINE_INACTIVE' } });

    const response = await patch({ current_state: 'INSPECTION' });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Inactive machines cannot receive operational status changes',
    });
  });

  it('없는 설비는 여전히 404 다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'MACHINE_NOT_FOUND' } });

    const response = await patch({ current_state: 'INSPECTION' });

    expect(response.status).toBe(404);
  });

  it('알 수 없는 상태값은 400 이다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '22P02', message: 'invalid input value for enum' } });

    const response = await patch({ current_state: 'NOT_A_STATE' });

    expect(response.status).toBe(400);
  });

  it('바꿀 필드가 없으면 RPC 를 부르지 않는다', async () => {
    const response = await patch({ change_reason: '메모만' });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('PUT /api/machines/[machineId] — 관리자 경로는 그대로다', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'admin-1', role: 'admin' });
  });

  it('비활성 설비도 계속 수정할 수 있어야 하므로 require_active 를 켜지 않는다', async () => {
    rpc.mockResolvedValue(okRpc());

    const response = await PUT(
      {
        json: async () => ({ name: 'CNC-01', location: 'A동', current_state: 'NORMAL_OPERATION' }),
      } as never,
      { params } as never
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'apply_machine_update',
      expect.objectContaining({ p_require_active: false })
    );
  });
});
