const mockFrom = jest.fn();

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a) },
}));

import { getBreakTimeMinutes, DEFAULT_BREAK_TIME_MINUTES } from '../plannedRuntime';
import { getBusinessTimeConfig } from '../shiftConfig';

/**
 * Codex 감사 2026-07-29 #7 회귀 검사.
 *
 * 이 두 함수는 세 가지 서로 다른 상황을 하나의 기본값으로 뭉갰다:
 *   (a) 설정한 적 없음  (b) 조회 실패  (c) 값이 깨짐
 *
 * **테스트의 전부는 세 경우가 서로 다르게 동작한다는 것**이다. 그래서 (a)와 (b)를
 * 반드시 나눠서 단언한다 — 한쪽만 검사하면 예전 구현도 통과한다.
 *
 * 운영 휴식 설정은 110분이고 코드 기본값은 60분이라, (b)를 (a)로 취급하면 계획
 * 가동시간이 50분 어긋난 채 확정 저장된다.
 */

/** category='shift' + setting_key 로 한 행을 찾는 체이닝: select→eq→eq→eq→maybeSingle */
const breakQuery = (result: { data: unknown; error: unknown }) => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.maybeSingle = async () => result;
  return q;
};

/** 카테고리 두 개를 한 번에 읽는 체이닝: select→in→eq */
const settingsQuery = (result: { data: unknown; error: unknown }) => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.in = () => q;
  q.eq = async () => result;
  return q;
};

describe('getBreakTimeMinutes — 조회 실패와 설정 부재를 구분한다', () => {
  beforeEach(() => jest.clearAllMocks());

  it('(a) 행이 없으면 기본값 60분을 쓴다', async () => {
    // maybeSingle 은 행이 없을 때 error 없이 data=null 을 준다 — 이것이 "설정한 적 없음"이다.
    mockFrom.mockReturnValue(breakQuery({ data: null, error: null }));

    await expect(getBreakTimeMinutes()).resolves.toBe(DEFAULT_BREAK_TIME_MINUTES);
  });

  it('(b) 조회가 실패하면 던진다 — 기본값으로 위장하지 않는다', async () => {
    mockFrom.mockReturnValue(breakQuery({ data: null, error: { message: 'connection reset' } }));

    await expect(getBreakTimeMinutes()).rejects.toThrow(/조회하지 못했습니다/);
  });

  it('(c) 값이 숫자가 아니면 던진다', async () => {
    mockFrom.mockReturnValue(breakQuery({ data: { setting_value: { value: 'abc' } }, error: null }));

    await expect(getBreakTimeMinutes()).rejects.toThrow(/유효하지 않습니다/);
  });

  it('(c) 값이 음수면 던진다', async () => {
    mockFrom.mockReturnValue(breakQuery({ data: { setting_value: { value: -10 } }, error: null }));

    await expect(getBreakTimeMinutes()).rejects.toThrow(/유효하지 않습니다/);
  });

  it('정상 설정값(운영값 110분)을 그대로 돌려준다', async () => {
    mockFrom.mockReturnValue(breakQuery({ data: { setting_value: { value: 110 } }, error: null }));

    await expect(getBreakTimeMinutes()).resolves.toBe(110);
  });

  it('0분은 유효한 설정이다 — 기본값으로 덮지 않는다', async () => {
    // 0 은 falsy 라서 `|| DEFAULT` 류의 구현이 조용히 60 으로 바꿔버리기 쉬운 값이다.
    mockFrom.mockReturnValue(breakQuery({ data: { setting_value: { value: 0 } }, error: null }));

    await expect(getBreakTimeMinutes()).resolves.toBe(0);
  });
});

describe('getBusinessTimeConfig — 조회 실패와 설정 부재를 구분한다', () => {
  beforeEach(() => jest.clearAllMocks());

  it('(a) 설정 행이 하나도 없으면 기본 교대 경계를 쓴다', async () => {
    mockFrom.mockReturnValue(settingsQuery({ data: [], error: null }));

    await expect(getBusinessTimeConfig()).resolves.toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      shiftAStart: '08:00',
      shiftBStart: '20:00',
      shiftChangeBufferMinutes: 10,
    });
  });

  it('(b) 조회가 실패하면 던진다', async () => {
    mockFrom.mockReturnValue(settingsQuery({ data: null, error: { message: 'timeout' } }));

    await expect(getBusinessTimeConfig()).rejects.toThrow(/조회하지 못했습니다/);
  });

  it('저장된 교대 시작 시각을 읽는다', async () => {
    mockFrom.mockReturnValue(settingsQuery({
      data: [
        { category: 'general', setting_key: 'timezone', setting_value: { value: 'Asia/Seoul' } },
        { category: 'shift', setting_key: 'shift_a_start', setting_value: { value: '07:30' } },
        { category: 'shift', setting_key: 'shift_b_start', setting_value: { value: '19:30' } },
        { category: 'shift', setting_key: 'shift_change_buffer_minutes', setting_value: { value: 15 } },
      ],
      error: null,
    }));

    await expect(getBusinessTimeConfig()).resolves.toEqual({
      timezone: 'Asia/Seoul',
      shiftAStart: '07:30',
      shiftBStart: '19:30',
      shiftChangeBufferMinutes: 15,
    });
  });

  it('전환 유예 0분은 유효한 설정이다 — 기본값 10분으로 덮지 않는다', () => {
    // 0 은 falsy 라 `|| DEFAULT` 류 구현이 조용히 10 으로 바꿔버리기 쉬운 값이다.
    mockFrom.mockReturnValue(settingsQuery({
      data: [{ category: 'shift', setting_key: 'shift_change_buffer_minutes', setting_value: { value: 0 } }],
      error: null,
    }));

    return expect(getBusinessTimeConfig()).resolves.toMatchObject({ shiftChangeBufferMinutes: 0 });
  });
});
