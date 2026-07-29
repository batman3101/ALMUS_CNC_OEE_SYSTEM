/**
 * 교대 관련 설정의 기본값 — **서버와 화면이 반드시 같은 값을 봐야 하는** 상수들.
 *
 * 왜 별도 모듈인가: 원래 이 값들은 서버 쪽에만 있었다. `DEFAULT_BREAK_TIME_MINUTES` 는
 * `plannedRuntime.ts`, `DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES` 는 `shiftConfig.ts` 에 있고
 * 둘 다 `supabase-admin` 을 import 하는 서버 전용 모듈이라 클라이언트 컴포넌트가 가져다 쓸
 * 수 없었다. 그래서 설정 화면은 자기 숫자를 따로 적었고, 전환 유예가 **화면 15분 / 서버
 * 10분**으로 갈라진 채 운영됐다(적대적 재감사 #9).
 *
 * 설정이 비어 있을 때 화면과 서버가 서로 다른 값으로 계산하면, 관리자는 자기가 본 적 없는
 * 규칙으로 만들어진 결과를 보게 된다. 그래서 의존성이 없는 순수 상수 모듈로 떼어내
 * 양쪽이 같은 곳을 가리키게 한다.
 */

/** 교대당 휴식 시간(분). `planned_runtime = max(0, 가동시간 − 휴식)` 에 쓰인다. */
export const DEFAULT_BREAK_TIME_MINUTES = 60;

/**
 * 교대 전환 유예(분). 교대 종료 후 이 시간까지는 진척 보고를 받고, **그 뒤부터** 마감을
 * 받는다(두 창은 서로소여야 한다 — `shiftReportingWindow.ts` 참조).
 */
export const DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES = 10;

/**
 * 설정값 → 실제로 쓸 값. **`??` 여야 하고 `||` 이면 안 된다.**
 *
 * 관리자가 명시적으로 0(휴식 없음 / 유예 없음)을 고를 수 있다. `||` 는 그 0 을 falsy 로 보고
 * 기본값으로 되돌리므로, 화면은 60 을 보여주는데 DB 에는 0 이 든 상태가 되고 저장을 누르면
 * 고른 적 없는 값이 저장된다.
 *
 * 왜 상수를 노출하고도 굳이 함수를 두는가 — 브라우저 테스트에서 배운 것이다. 폼 초기값의
 * `|| 60` 은 고쳤는데 같은 화면의 요약 계산에 있던 `|| 60` 을 놓쳤고, 그 결과 입력칸은 0,
 * 요약은 "교대당 60분"을 동시에 보여줬다. 한 화면 안에서 두 숫자가 다른 규칙을 따른 것이다.
 * 규칙을 함수로 만들면 "양쪽을 같이 고쳐야 한다"를 사람이 기억하지 않아도 된다.
 */
export function resolveBreakMinutes(value: number | null | undefined): number {
  return value ?? DEFAULT_BREAK_TIME_MINUTES;
}

export function resolveShiftChangeBufferMinutes(value: number | null | undefined): number {
  return value ?? DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES;
}
