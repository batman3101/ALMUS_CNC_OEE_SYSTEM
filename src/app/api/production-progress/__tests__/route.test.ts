jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockRequireUser = jest.fn();
const mockAssertMachineAccess = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: (...a: unknown[]) => mockAssertMachineAccess(...a),
  apiAuthErrorResponse: () => null,
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a) },
}));

import { POST } from '../route';

const MACHINE = '11111111-1111-4111-8111-111111111111';

const request = (body: unknown) => ({
  url: 'http://localhost/api/production-progress',
  json: async () => body,
}) as never;

/** 마지막 보고 조회 → insert 를 순서대로 흉내낸다. */
const mockChain = (lastReport: { shift_output_qty: number } | null) => {
  const insert = jest.fn().mockResolvedValue({ error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'production_progress_reports') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({ maybeSingle: async () => ({ data: lastReport, error: null }) }),
                }),
              }),
            }),
          }),
        }),
        insert,
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { insert };
};

describe('POST /api/production-progress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssertMachineAccess.mockReturnValue(undefined);
  });

  it('보고를 저장한다', async () => {
    const { insert } = mockChain({ shift_output_qty: 60 });

    const res = await POST(request({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: 150,
    }));

    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A',
      shift_output_qty: 150, operator_id: 'op-1',
    }));
    // 인가 검사는 "호출됐다"로는 부족하다 — 엉뚱한 설비를 물어보면 담당자 검사가 무의미해진다.
    // 요청 본문의 설비와 인증된 사용자로 물었는지 인자까지 고정한다.
    expect(mockAssertMachineAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'op-1' }),
      MACHINE,
    );
  });

  // 값의 의미가 "교대 누적"이므로 감소는 불가능하다. 조용히 받으면 90개가 증발한다.
  it('보고값이 줄어들면 거부하고 되묻는다', async () => {
    const { insert } = mockChain({ shift_output_qty: 150 });

    const res = await POST(request({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: 60,
    }));

    expect(res.status).toBe(409);
    expect(insert).not.toHaveBeenCalled();
    const body = await res.json() as { error: string; last_reported_qty: number };
    expect(body.last_reported_qty).toBe(150);
  });

  it('같은 값 재보고는 허용한다 (변화 없음은 감소가 아니다)', async () => {
    const { insert } = mockChain({ shift_output_qty: 150 });

    const res = await POST(request({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: 150,
    }));

    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalled();
  });

  it('첫 보고는 이전 값이 없어도 저장된다', async () => {
    const { insert } = mockChain(null);

    const res = await POST(request({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: 30,
    }));

    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalled();
  });

  it('담당이 아닌 설비는 거부한다', async () => {
    mockChain(null);
    mockAssertMachineAccess.mockImplementation(() => { throw new Error('forbidden'); });

    await expect(POST(request({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: 30,
    }))).rejects.toThrow();
  });

  it('음수는 400 으로 거부한다', async () => {
    mockChain(null);
    const res = await POST(request({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: -1,
    }));
    expect(res.status).toBe(400);
  });
});
