/**
 * 계획 가동시간(planned_runtime) 계산식 변경 기준일.
 *
 * - 이 날짜 이전에 저장된 모든 기록(약 325,197건, ~2026-07-06까지 저장분):
 *   planned_runtime = 720 (12시간 교대, 휴식시간 미차감으로 저장됨).
 *   그중 B교대 기록(약 162,738건)은 버그로 인해 planned_runtime = 0 으로 저장되어 있었다.
 * - 이 날짜 이후 저장되는 모든 기록:
 *   planned_runtime = operating_minutes - break_time_minutes
 *   (system_settings 의 휴식시간을 차감. 현재 설정 기준 720 - 110 = 610분)
 *
 * 가동률(Availability) = 실제 가동시간 / 계획 가동시간 이므로, 동일한 물리적 가동 시간이라도
 * 계산식 변경 전후로 가동률·OEE 값이 달라진다
 * (예: 실제 가동 600분 기준 → 변경 전 600/720=83.3%, 변경 후 600/610=98.4%).
 * 이는 계산식이 바뀐 데 따른 인위적인 수치 변화일 뿐 실제 설비 성능 개선이 아니므로,
 * 이 기준일을 넘나드는 추이 비교(차트)는 반드시 시각적으로 구분해서 보여줘야 한다.
 *
 * 과거 데이터는 재계산(백필)하지 않기로 결정되었다 — 이 모듈은 그 사실을 UI에서
 * 일관되게 표시하기 위한 단일 기준점이다.
 *
 * 주의: 이 모듈은 클라이언트 컴포넌트에서도 import 되므로 서버 전용 코드
 * (예: @/lib/supabase-admin)를 절대 import 하지 않는다.
 * 서버 측 실제 planned_runtime 계산 로직은 src/lib/plannedRuntime.ts 를 참고할 것
 * (해당 파일은 서버 전용이라 클라이언트 컴포넌트에서 import 하면 안 된다).
 */
export const OEE_CALC_CHANGE_DATE = '2026-07-13';

/**
 * 'YYYY-MM-DD' 이외의 형식(ISO 타임스탬프 등)으로 들어와도 앞 10자리만 비교에 사용한다.
 */
function normalizeDate(date: string): string {
  return date.length >= 10 ? date.slice(0, 10) : date;
}

/**
 * 주어진 날짜가 계산식 변경일 이전(구 계산식 적용 구간)인지 여부.
 */
export function isBeforeOeeCalcChange(date: string): boolean {
  return normalizeDate(date) < OEE_CALC_CHANGE_DATE;
}

/**
 * [startDate, endDate] 구간이 계산식 변경일을 포함하는지 여부.
 */
export function rangeContainsOeeCalcChange(startDate: string, endDate: string): boolean {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  return start <= OEE_CALC_CHANGE_DATE && end >= OEE_CALC_CHANGE_DATE;
}

/**
 * 날짜 문자열 배열(정렬 여부 무관)의 최소~최대 범위가 계산식 변경일을 포함하는지 여부.
 * 차트에 표시 중인 날짜들이 변경일 양쪽에 걸쳐 있을 때만 true.
 */
export function isCutoverInRange(dates: string[]): boolean {
  if (dates.length === 0) return false;

  let min = normalizeDate(dates[0]);
  let max = min;

  for (const raw of dates) {
    const d = normalizeDate(raw);
    if (d < min) min = d;
    if (d > max) max = d;
  }

  return rangeContainsOeeCalcChange(min, max);
}
