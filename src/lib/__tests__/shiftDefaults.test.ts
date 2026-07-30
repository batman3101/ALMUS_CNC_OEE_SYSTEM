import {
  DEFAULT_BREAK_TIME_MINUTES,
  DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES,
  resolveBreakMinutes,
  resolveShiftChangeBufferMinutes,
} from '../shiftDefaults';

/**
 * 적대적 재감사 2026-07-29 #9 회귀 검사.
 *
 * `||` 는 관리자가 **명시적으로 고른 0**(휴식 없음 / 전환 유예 없음)을 falsy 로 보고 기본값으로
 * 되돌린다. 화면은 60 을 보여주는데 DB 에는 0 이 든 상태가 되고, 저장을 누르면 관리자가
 * 고른 적 없는 값이 저장된다.
 *
 * 이 파일이 존재하는 진짜 이유는 그 다음이다. 폼 초기값의 `|| 60` 은 고쳤는데 같은 화면의
 * **요약 계산**에 있던 `|| 60` 을 놓쳤고, 프리뷰 브라우저 테스트에서 입력칸은 0 · 요약은
 * "교대당 60분"을 동시에 보여주는 것으로 드러났다. 규칙을 함수로 모으고 그 함수를 여기서
 * 고정해, "양쪽을 같이 고쳐야 한다"를 사람이 기억하지 않아도 되게 한다.
 */
describe('교대 설정 기본값 해석', () => {
  it('명시적 0 을 보존한다 (이 한 줄이 결함의 전부)', () => {
    expect(resolveBreakMinutes(0)).toBe(0);
    expect(resolveShiftChangeBufferMinutes(0)).toBe(0);
  });

  it('설정하지 않은 경우에만 기본값을 쓴다', () => {
    expect(resolveBreakMinutes(undefined)).toBe(DEFAULT_BREAK_TIME_MINUTES);
    expect(resolveBreakMinutes(null)).toBe(DEFAULT_BREAK_TIME_MINUTES);
    expect(resolveShiftChangeBufferMinutes(undefined)).toBe(DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES);
    expect(resolveShiftChangeBufferMinutes(null)).toBe(DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES);
  });

  it('설정한 값을 그대로 돌려준다', () => {
    expect(resolveBreakMinutes(110)).toBe(110);
    expect(resolveShiftChangeBufferMinutes(15)).toBe(15);
  });

  it('전환 유예 기본값은 서버와 같은 10분이다', () => {
    // 예전에는 화면만 15분이었다. 설정이 비어 있을 때 화면과 서버가 서로 다른 값으로
    // 계산하면, 관리자는 자기가 본 적 없는 규칙으로 만들어진 결과를 보게 된다.
    expect(DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES).toBe(10);
  });
});
