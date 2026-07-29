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
 *
 * **조회 실패를 기본값으로 위장하지 않는다.** 이전 구현은 `if (error || !data)` 와
 * `catch {}` 로 세 가지 다른 상황을 하나의 60분으로 뭉갰다:
 *
 *   (a) 설정한 적이 없다        → 60분이 정당하다
 *   (b) 조회가 실패했다          → 아무것도 단언할 수 없다
 *   (c) 값이 있는데 깨져 있다    → 설정이 잘못됐다고 알려야 한다
 *
 * 운영 설정은 **110분**이다. (b)나 (c)에서 조용히 60분을 쓰면 planned_runtime 이
 * 610분이 아니라 660분으로 계산되고, 그 가동률이 스냅샷으로 **영구 저장**된다.
 * 나중에 설정 조회가 정상으로 돌아와도 저장된 행은 따라오지 않는다.
 *
 * 그래서 (a)만 기본값을 쓰고, (b)와 (c)는 던진다.
 */
export async function getBreakTimeMinutes(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('system_settings')
    .select('setting_value')
    .eq('category', 'shift')
    .eq('setting_key', 'break_time_minutes')
    .eq('is_active', true)
    .maybeSingle();

  // (b) 조회 실패 — maybeSingle 은 행이 없으면 error 없이 data=null 을 준다.
  //     따라서 error 가 있다는 것은 "행이 없다" 가 아니라 "읽지 못했다" 뿐이다.
  if (error) {
    throw new Error(`휴식 시간 설정을 조회하지 못했습니다: ${error.message}`);
  }

  // (a) 설정한 적 없음 — 기본값이 정당한 유일한 경우.
  if (!data) {
    return DEFAULT_BREAK_TIME_MINUTES;
  }

  // setting_value 는 jsonb: { "value": 110 }
  const raw = (data.setting_value as { value?: unknown } | null)?.value;
  const parsed =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;

  // (c) 값은 있는데 숫자가 아니다 — 조용히 60분으로 덮으면 설정이 깨진 사실이 영영 안 드러난다.
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`휴식 시간 설정값이 유효하지 않습니다: ${JSON.stringify(raw)}`);
  }

  return parsed;
}

/**
 * 계획 가동시간 계산: max(0, operatingMinutes - breakMinutes)
 * operatingMinutes 가 없을 때만 기본 가동시간(720분)을 사용한다. 명시적인 0분은
 * 계획 가동이 없는 교대로 보존한다.
 */
export function resolvePlannedRuntime(operatingMinutes: unknown, breakMinutes: number): number {
  const operating =
    typeof operatingMinutes === 'number' && Number.isFinite(operatingMinutes) && operatingMinutes >= 0
      ? operatingMinutes
      : DEFAULT_OPERATING_MINUTES;

  const breakTime =
    Number.isFinite(breakMinutes) && breakMinutes > 0 ? breakMinutes : 0;

  return Math.max(0, operating - breakTime);
}
