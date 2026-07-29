const rpc = jest.fn();
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { rpc: (...args: unknown[]) => rpc(...args) } }));
jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));

import {
  InvalidMachineUpdateError,
  MachineInactiveError,
  MachineNotFoundError,
  applyMachineUpdate,
  machineUpdateErrorResponse,
  pickMachineUpdates,
} from '../machineUpdate';

describe('BUG-016 machine update validation', () => {
  it('accepts JSON booleans including false', () => {
    expect(pickMachineUpdates({ is_active: false })).toEqual({ is_active: false });
  });

  it.each([{ is_active: 'false' }, { is_active: 0 }, { is_active: null }])(
    'rejects non-boolean is_active: %p',
    body => expect(() => pickMachineUpdates(body)).toThrow(InvalidMachineUpdateError)
  );

  it.each([{ name: null }, { name: '' }, { name: '   ' }])(
    'rejects invalid name: %p',
    body => expect(() => pickMachineUpdates(body)).toThrow(InvalidMachineUpdateError)
  );

  it('trims required and nullable string fields', () => {
    expect(pickMachineUpdates({
      name: ' CNC-01 ',
      current_state: ' NORMAL_OPERATION ',
      location: null,
      equipment_type: ' Lathe ',
    })).toEqual({
      name: 'CNC-01',
      current_state: 'NORMAL_OPERATION',
      location: null,
      equipment_type: 'Lathe',
    });
  });
});

describe('비활성 설비 판단을 RPC(잠금 안)로 넘긴 계약', () => {
  beforeEach(() => rpc.mockReset());

  it('RPC 인자는 4개 그대로다 — 시그니처가 바뀌면 배포 창이 생긴다', async () => {
    rpc.mockResolvedValue({ data: { machine: {}, state_changed: false, duration_minutes: null }, error: null });

    await applyMachineUpdate('m1', { current_state: 'INSPECTION' }, null, 'u1');

    // 인자를 하나라도 늘리면 옛 함수를 DROP 해야 하고(안 그러면 잠금 없는 오버로드가 남는다),
    // 그 순간 마이그레이션과 코드 배포 사이에 "함수 없음" 창이 생긴다.
    expect(rpc).toHaveBeenCalledWith('apply_machine_update', {
      p_machine_id: 'm1',
      p_updates: { current_state: 'INSPECTION' },
      p_change_reason: null,
      p_changed_by: 'u1',
    });
  });

  it('RPC 의 MACHINE_INACTIVE 를 409 로 옮긴다 (예전 사전 조회와 같은 문구)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '55000', message: 'MACHINE_INACTIVE' } });

    await expect(
      applyMachineUpdate('m1', { current_state: 'INSPECTION' }, null, 'u1')
    ).rejects.toBeInstanceOf(MachineInactiveError);

    const response = machineUpdateErrorResponse(new MachineInactiveError()) as unknown as {
      status: number;
      body: { error: string };
    };
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Inactive machines cannot receive operational status changes');
  });

  it('설비가 없으면 여전히 404 다 — 사전 조회를 없앴다고 404 가 사라지면 안 된다', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'MACHINE_NOT_FOUND' } });

    await expect(
      applyMachineUpdate('missing', { current_state: 'INSPECTION' }, null, 'u1')
    ).rejects.toBeInstanceOf(MachineNotFoundError);

    const response = machineUpdateErrorResponse(new MachineNotFoundError()) as unknown as { status: number };
    expect(response.status).toBe(404);
  });

  it('비활성 오류를 500 으로 흘려보내지 않는다', () => {
    // MachineInactiveError 를 매핑 목록에 넣지 않으면 라우트의 catch 가 500 을 반환한다.
    // 사용자에게는 "서버 오류"로 보이고, 실제로는 정상적인 거부다.
    expect(machineUpdateErrorResponse(new MachineInactiveError())).not.toBeNull();
  });
});
