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
const mockAssertMachineAccess = jest.fn();
const selectedColumns: string[] = [];
const eqCalls: Array<[string, unknown]> = [];
const FACTORY = '00000000-0000-4000-8000-00000000a17e';
// 소유 확인 조회의 결과. null 로 두면 "이 공장 설비가 아니다" 를 흉내낸다.
let ownedRow: { id: string; is_active: boolean } | null = { id: 'machine-1', is_active: true };

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  assertMachineAccess: jest.fn(),
  apiAuthErrorResponse: (error: unknown) =>
    error instanceof Error && error.message === 'unauthorized'
      ? { status: 401, json: async () => ({ error: 'unauthorized' }) }
      : null,
}));

/**
 * 이 Route 는 공장 인지 계약(`requireFactoryUser`)으로 전환됐다.
 *
 * 새 mock 을 따로 만들지 않고 **같은 함수**에 연결한다. 그래야 아래 단언들이 검증하던
 * 성질이 그대로 유지된다 — 거부가 조회보다 먼저인가, 허용 역할 목록이 무엇인가.
 * 별도 mock 을 두면 두 벌이 되고, 한쪽만 고쳐지는 순간 검사가 헐거워진다.
 */
jest.mock('@/lib/factoryAuth', () => ({
  requireFactoryUser: (...args: unknown[]) => mockRequireUser(...args),
  assertFactoryMachineAccess: (...args: unknown[]) => mockAssertMachineAccess(...args),
}));


// from() 은 호출을 기록하되 **정상적으로 동작하는** 체인을 돌려준다.
// 사전 조회가 되살아나도 크래시가 아니라 성공하게 두어야, "조회했다"는 사실 자체로
// 테스트가 실패한다. 크래시로 실패하면 다른 이유로도 실패해 무엇을 검증하는지 흐려진다.
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => {
      from(...args);
      const result = { data: ownedRow, error: null };
      const query: Record<string, unknown> = {
        select: (cols?: string) => { selectedColumns.push(cols ?? '*'); return query; },
        eq: (col: string, val: unknown) => { eqCalls.push([col, val]); return query; },
        single: async () => result,
        maybeSingle: async () => result,
        then: (resolve: (v: unknown) => unknown) => resolve(result),
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
    selectedColumns.length = 0;
    eqCalls.length = 0;
    ownedRow = { id: 'machine-1', is_active: true };
    mockRequireUser.mockResolvedValue({ userId: 'op-1', factoryId: FACTORY, role: 'operator' });
  });

  it('RPC 를 4-인자 그대로 호출한다 (전방 호환)', async () => {
    rpc.mockResolvedValue(okRpc());

    const response = await patch({ current_state: 'INSPECTION' });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('apply_machine_update', {
      p_machine_id: 'machine-1',
      p_updates: { current_state: 'INSPECTION' },
      p_change_reason: null,
      p_changed_by: 'op-1',
    });
  });

  it('RPC 전에 가변 상태(is_active/current_state)를 미리 판단하지 않는다', async () => {
    // 이것이 잠금 규약의 핵심이다. 사전 조회는 RPC 트랜잭션 **밖**이라 advisory lock 을 잡지
    // 않는다. 그 조회로 "활성이다"를 판단하면, 조회와 쓰기 사이에 설비가 비활성화돼도 쓰기가
    // 진행된다. 가변 상태의 판단은 잠금을 잡은 RPC 안에서만 이뤄져야 한다.
    //
    // ■ 2026-08-24: 명제를 "사전 조회 금지"에서 "가변 상태 사전 판단 금지"로 좁혔다.
    //
    //   공장 소유 확인(`assertMachineInFactory`)이 RPC 앞에 하나 생겼다. 이것을 잠금 규약
    //   위반으로 볼 수 없는 이유는, 판단 대상이 **변하지 않는 값**이기 때문이다:
    //     - `machines.id` 는 PK 라 전역 유일하다 → id 하나는 언제나 같은 한 행을 가리킨다
    //     - 그 행의 `factory_id` 는 NOT NULL 이고 갱신 화이트리스트(ALLOWED_KEYS)에 없다
    //       → 설비를 공장 사이로 옮기는 경로가 존재하지 않는다
    //   두 사상(寫像)이 모두 불변이므로 이 조회의 결론은 시간이 지나도 유효하다. 변하지
    //   않는 것에는 TOCTOU 가 없다.
    //
    //   그래서 검사도 그에 맞게 정밀해진다 — "조회가 없다"가 아니라 "조회가 `id` 와
    //   `factory_id` 만 본다"를 확인한다. 설비 이관 기능이 생기는 날 이 전제가 깨지므로,
    //   그때는 확인을 RPC 안으로 옮겨야 한다(새 이름 + 3단계 배포).
    rpc.mockResolvedValue(okRpc());

    await patch({ current_state: 'INSPECTION' });

    // 사전 조회는 소유 확인 하나뿐이고, 그 조회는 상태 컬럼을 아예 읽지 않는다.
    expect(selectedColumns).toEqual(['id']);
    expect(eqCalls).toEqual([
      ['factory_id', FACTORY],
      ['id', 'machine-1'],
    ]);
  });

  it('다른 공장 설비는 RPC 를 부르기도 전에 404 다', async () => {
    // 소유 확인이 RPC **앞**에 있어야 의미가 있다. 뒤에 있으면 이미 쓰고 나서 거절하게 된다.
    // 그래서 상태 코드만 보지 않고 `rpc` 가 아예 호출되지 않았음을 함께 확인한다.
    ownedRow = null;
    rpc.mockResolvedValue(okRpc());

    const response = await patch({ current_state: 'INSPECTION' });

    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
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
    selectedColumns.length = 0;
    eqCalls.length = 0;
    ownedRow = { id: 'machine-1', is_active: true };
    mockRequireUser.mockResolvedValue({ userId: 'admin-1', factoryId: FACTORY, role: 'admin' });
  });

  it('PATCH 와 완전히 같은 RPC 시그니처를 쓴다', async () => {
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
      expect.objectContaining({ p_machine_id: 'machine-1', p_changed_by: 'admin-1' })
    );
    // 호출자를 구분하는 인자가 없어야 한다 — 있으면 옛 함수를 DROP 해야 하고 배포 창이 생긴다.
    expect(Object.keys(rpc.mock.calls[0][1] as object).sort()).toEqual(
      ['p_change_reason', 'p_changed_by', 'p_machine_id', 'p_updates']
    );
  });

  it('비활성 설비의 이름만 바꾸는 것은 막지 않는다 (상태가 안 바뀌면 RPC 가 통과시킨다)', async () => {
    // 라우트는 더 이상 비활성 여부로 분기하지 않는다. 판단은 전부 RPC(잠금 안)에 있고,
    // RPC 는 **상태가 바뀔 때만** 거부한다. 라우트가 이를 앞질러 막으면 안 된다.
    rpc.mockResolvedValue(okRpc());

    const response = await PUT(
      {
        json: async () => ({ name: '새이름', location: 'A동', current_state: 'NORMAL_OPERATION' }),
      } as never,
      { params } as never
    );

    expect(response.status).toBe(200);
    // PUT 도 같다 — 사전 조회는 공장 소유 확인뿐이고 상태 컬럼을 읽지 않는다.
    expect(selectedColumns).toEqual(['id']);
  });
});
