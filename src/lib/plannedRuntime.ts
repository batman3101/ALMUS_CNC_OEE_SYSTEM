import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * 계획 가동시간(planned_runtime)의 단일 정의.
 *
 *   planned_runtime = max(0, operating_minutes - break_time_minutes)
 *
 * - operating_minutes: 클라이언트가 입력한 교대별 가동시간 (미전송 시 12시간 = 720분)
 * - break_time_minutes: system_settings(category='shift') 의 관리자 설정값
 *
 * OEE 표준상 계획된 휴식 시간은 계획 생산 시간에서 제외되며,
 * 폼의 CAPA 계산(ShiftDataInputForm.calculateCapacity)과도 동일한 기준이다.
 */

// 교대 1회 기본 가동시간 (12시간 = 720분)
export const DEFAULT_OPERATING_MINUTES = 720;

// system_settings 에 break_time_minutes 가 없거나 조회 실패한 경우에만 사용하는 기본값
export const DEFAULT_BREAK_TIME_MINUTES = 60;

/**
 * system_settings(category='shift', setting_key='break_time_minutes') 에서 휴식 시간 조회.
 * 설정이 없거나 조회에 실패하면 DEFAULT_BREAK_TIME_MINUTES(60분)를 반환한다.
 */
export async function getBreakTimeMinutes(): Promise<number> {
  try {
    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .select('setting_value')
      .eq('category', 'shift')
      .eq('setting_key', 'break_time_minutes')
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      return DEFAULT_BREAK_TIME_MINUTES;
    }

    // setting_value 는 jsonb: { "value": 110 }
    const raw = (data.setting_value as { value?: unknown } | null)?.value;
    const parsed =
      typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BREAK_TIME_MINUTES;
  } catch {
    return DEFAULT_BREAK_TIME_MINUTES;
  }
}

/**
 * 계획 가동시간 계산: max(0, operatingMinutes - breakMinutes)
 * operatingMinutes 가 없거나 0 이하이면 기본 가동시간(720분)을 사용한다.
 */
export function resolvePlannedRuntime(operatingMinutes: unknown, breakMinutes: number): number {
  const operating =
    typeof operatingMinutes === 'number' && Number.isFinite(operatingMinutes) && operatingMinutes > 0
      ? operatingMinutes
      : DEFAULT_OPERATING_MINUTES;

  const breakTime =
    Number.isFinite(breakMinutes) && breakMinutes > 0 ? breakMinutes : 0;

  return Math.max(0, operating - breakTime);
}
