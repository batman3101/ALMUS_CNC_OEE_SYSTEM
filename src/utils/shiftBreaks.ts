/**
 * 교대별 휴식 시간대.
 *
 * system_settings(category='shift') 는 총량(break_time_minutes = 110)만 알고 시각은 모른다.
 * 실시간 가동률을 계산하려면 "지금까지 휴식이 얼마나 지났나"가 필요하므로 시각을 여기 둔다.
 *
 * ⚠️ 이 상수는 DB 의 break_time_minutes(관리자가 UI 에서 변경 가능)와 **자동으로 동기화되지
 *    않는다.** 단위 테스트는 DB 를 볼 수 없어 리터럴끼리 비교할 뿐이므로 어긋남을 잡지 못한다.
 *    관리자가 휴식 총량을 바꾸면 실시간 화면과 확정 OEE 가 영구히 어긋난다.
 *    → 어긋남 검출은 설정값을 읽을 수 있는 호출부(API)의 책임이다. TOTAL_BREAK_MINUTES 와
 *      getBreakTimeMinutes() 가 다르면 계산하지 말고 "계산 불가"로 알려야 한다.
 *
 * 기존 plannedRuntime.ts 는 총량을 계속 쓰며 건드리지 않는다.
 *
 * 중식·석식 시각이 가끔 바뀌어도 고정값으로 둔다(현장 결정). 4개 구간이 모두 교대 안에
 * 있으므로 교대가 끝나면 110분이 다 지나가고, 배치는 교대 *중* 정밀도에만 영향을 준다.
 */

/** 교대 시작으로부터의 분 단위 오프셋. B 교대의 23:20~00:20 은 자정을 넘지만 오프셋으로
 *  표현하면 경계가 사라진다 (20:00 시작 → 200분~260분). */
export interface BreakWindow {
  /** 교대 시작 이후 경과 분 */
  readonly startOffsetMinutes: number;
  /** 휴식 길이(분). 이 저장소는 분/초 혼동으로 사고를 낸 적이 있어 단위를 이름에 박아둔다. */
  readonly durationMinutes: number;
}

export const TOTAL_BREAK_MINUTES = 110;

/**
 * A: 08:00 시작 → 09:50(110분), 11:20(200분), 14:50(410분), 17:30(570분)
 * B: 20:00 시작 → 21:50(110분), 23:20(200분), 02:50(410분), 05:30(570분)
 * 두 교대의 오프셋이 같다 (야간조는 주간조에 대응하는 시각).
 */
const BREAK_WINDOWS: readonly BreakWindow[] = [
  { startOffsetMinutes: 110, durationMinutes: 10 },  // A 09:50~10:00 / B 21:50~22:00
  { startOffsetMinutes: 200, durationMinutes: 60 },  // A 11:20~12:20 / B 23:20~00:20 (자정 넘음)
  { startOffsetMinutes: 410, durationMinutes: 10 },  // A 14:50~15:00 / B 02:50~03:00
  { startOffsetMinutes: 570, durationMinutes: 30 },  // A 17:30~18:00 / B 05:30~06:00
];

export const SHIFT_BREAK_WINDOWS: Record<'A' | 'B', readonly BreakWindow[]> = {
  A: BREAK_WINDOWS,
  B: BREAK_WINDOWS,
};

/**
 * 마지막 휴식 시간대가 끝나는 지점 (교대 시작 후 분).
 *
 * 시간대는 720분 교대를 전제로 하드코딩돼 있다. 교대가 이보다 짧으면 시간대가 교대 밖으로
 * 나가 "경과 기준 휴식"과 "총량 110분" 이 어긋난다 — 즉 이 표 자체가 그 교대에는 맞지 않는다.
 */
export const BREAK_WINDOWS_END_OFFSET_MINUTES = 600;

/**
 * 교대 시작부터 now 까지 지나간 휴식(분). 진행 중인 휴식은 지난 만큼만 센다.
 * now 를 인자로 받아 결정론적으로 테스트한다 — 시각 의존은 flaky 의 원흉이다.
 */
export function elapsedBreakMinutes(shift: 'A' | 'B', shiftStart: Date, now: Date): number {
  const elapsed = (now.getTime() - shiftStart.getTime()) / 60_000;

  // 유효하지 않은 Date 를 0 으로 돌려주면 "아직 휴식 없음"과 구분되지 않는다. 그 0 은
  // 계획시간을 최대 110분 부풀려 가동률을 멀쩡해 보이게 만든다 — 모르는 것을 그럴듯한
  // 숫자로 단정하는 건 이 저장소가 이미 겪은 사고다.
  if (!Number.isFinite(elapsed)) {
    throw new Error('elapsedBreakMinutes: shiftStart 또는 now 가 유효한 Date 가 아닙니다');
  }

  // 교대 시작 전(시계 오차 등)은 정상적으로 0 이다.
  if (elapsed <= 0) return 0;

  return SHIFT_BREAK_WINDOWS[shift].reduce((total, w) => {
    const consumed = Math.min(Math.max(elapsed - w.startOffsetMinutes, 0), w.durationMinutes);
    return total + consumed;
  }, 0);
}
