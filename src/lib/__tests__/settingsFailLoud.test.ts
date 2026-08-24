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

/** 실제로 걸린 필터를 기록한다 — 공장 조건이 붙었는지 보기 위해서다. */
const eqCalls: Array<[string, unknown]> = [];

/**
 * PostgREST 빌더를 흉내낸다.
 *
 * 모든 필터 메서드가 **자신을 돌려주고**, 종단은 `maybeSingle()` 또는 `await`(thenable)이다.
 * 예전 mock 은 `.eq` 를 종단으로 두어 체인 **순서와 개수**를 코드에 박아 놨고, 그래서
 * 필터가 하나 늘 때마다 검사 내용과 무관한 이유로 깨졌다. 실제 빌더도 thenable 이므로
 * 이 형태가 더 정확하다.
 */
const builder = (result: { data: unknown; error: unknown }) => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'in', 'order', 'limit']) q[m] = () => q;
  q.eq = (column: string, value: unknown) => { eqCalls.push([column, value]); return q; };
  q.maybeSingle = async () => result;
  // await 로 끝나는 호출(getBusinessTimeConfig)을 위한 thenable.
  q.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return q;
};

const breakQuery = builder;
const settingsQuery = builder;

const FACTORY = '00000000-0000-4000-8000-00000000a17e';

describe('getBreakTimeMinutes — 조회 실패와 설정 부재를 구분한다', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eqCalls.length = 0;
  });

  it('(a) 행이 없으면 기본값 60분을 쓴다', async () => {
    // maybeSingle 은 행이 없을 때 error 없이 data=null 을 준다 — 이것이 "설정한 적 없음"이다.
    mockFrom.mockReturnValue(breakQuery({ data: null, error: null }));

    await expect(getBreakTimeMinutes(FACTORY)).resolves.toBe(DEFAULT_BREAK_TIME_MINUTES);
  });

  it('(b) 조회가 실패하면 던진다 — 기본값으로 위장하지 않는다', async () => {
    mockFrom.mockReturnValue(breakQuery({ data: null, error: { message: 'connection reset' } }));

    await expect(getBreakTimeMinutes(FACTORY)).rejects.toThrow(/조회하지 못했습니다/);
  });

  it('(c) 값이 숫자가 아니면 던진다', async () => {
    mockFrom.mockReturnValue(breakQuery({ data: { setting_value: { value: 'abc' } }, error: null }));

    await expect(getBreakTimeMinutes(FACTORY)).rejects.toThrow(/유효하지 않습니다/);
  });

  it('(c) 값이 음수면 던진다', async () => {
    mockFrom.mockReturnValue(breakQuery({ data: { setting_value: { value: -10 } }, error: null }));

    await expect(getBreakTimeMinutes(FACTORY)).rejects.toThrow(/유효하지 않습니다/);
  });

  it('정상 설정값(운영값 110분)을 그대로 돌려준다', async () => {
    mockFrom.mockReturnValue(breakQuery({ data: { setting_value: { value: 110 } }, error: null }));

    await expect(getBreakTimeMinutes(FACTORY)).resolves.toBe(110);
  });

  it('0분은 유효한 설정이다 — 기본값으로 덮지 않는다', async () => {
    // 0 은 falsy 라서 `|| DEFAULT` 류의 구현이 조용히 60 으로 바꿔버리기 쉬운 값이다.
    mockFrom.mockReturnValue(breakQuery({ data: { setting_value: { value: 0 } }, error: null }));

    await expect(getBreakTimeMinutes(FACTORY)).resolves.toBe(0);
  });
});

describe('getBusinessTimeConfig — 조회 실패와 설정 부재를 구분한다', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eqCalls.length = 0;
  });

  it('(a) 설정 행이 하나도 없으면 기본 교대 경계를 쓴다', async () => {
    mockFrom.mockReturnValue(settingsQuery({ data: [], error: null }));

    await expect(getBusinessTimeConfig(FACTORY)).resolves.toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      shiftAStart: '08:00',
      shiftBStart: '20:00',
      shiftChangeBufferMinutes: 10,
    });
  });

  it('(b) 조회가 실패하면 던진다', async () => {
    mockFrom.mockReturnValue(settingsQuery({ data: null, error: { message: 'timeout' } }));

    await expect(getBusinessTimeConfig(FACTORY)).rejects.toThrow(/조회하지 못했습니다/);
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

    await expect(getBusinessTimeConfig(FACTORY)).resolves.toEqual({
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

    return expect(getBusinessTimeConfig(FACTORY)).resolves.toMatchObject({ shiftChangeBufferMinutes: 0 });
  });
});

/**
 * 공장을 걸지 않으면 이 두 함수는 **다른 공장의 설정으로 계산한다.**
 *
 * `getBreakTimeMinutes` 는 `maybeSingle()` 이라 행이 2개면 에러가 나고 함수가 던진다 —
 * 시끄럽게 깨진다. `getBusinessTimeConfig` 는 값 추출이 `.find()` 라 정렬 없는 결과에서
 * 먼저 온 것을 집는다 — 조용히 틀린다. 타임존이 어긋나면 업무일이 어긋나고, B교대는
 * 자정을 넘으므로 하루치 실적이 통째로 옆날로 간다.
 *
 * 그래서 "공장 조건이 쿼리에 실제로 걸렸는가"를 못박는다. 인자를 받는 것만으로는 부족하다 —
 * 받아 놓고 쓰지 않는 것이 가장 흔한 실수다.
 */
describe('설정 조회는 공장으로 좁힌다', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eqCalls.length = 0;
  });

  it('getBreakTimeMinutes 가 factory_id 를 건다', async () => {
    mockFrom.mockReturnValue(breakQuery({ data: null, error: null }));
    await getBreakTimeMinutes(FACTORY);
    expect(eqCalls).toContainEqual(['factory_id', FACTORY]);
  });

  it('getBusinessTimeConfig 가 factory_id 를 건다', async () => {
    mockFrom.mockReturnValue(settingsQuery({ data: [], error: null }));
    await getBusinessTimeConfig(FACTORY);
    expect(eqCalls).toContainEqual(['factory_id', FACTORY]);
  });
});
