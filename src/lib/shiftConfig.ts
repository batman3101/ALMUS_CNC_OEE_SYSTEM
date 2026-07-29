import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * 교대 경계 계산에 필요한 설정(시간대·A/B 교대 시작시각)의 단일 소스.
 *
 * 확정 OEE(production-records/daily)와 실시간(production-progress)이 **같은 경계**를 쓰게
 * 하려고 한 곳에 모은다. 예전에는 daily/route 안에만 있어 실시간 경로가 downtime_entries 의
 * date/shift 컬럼으로 따로 귀속하다 확정과 어긋났다.
 */
export interface BusinessTimeConfig {
  timezone: string;
  shiftAStart: string;
  shiftBStart: string;
  /**
   * 교대 전환 유예(분). 교대 경계에서 딱 끊으면 종료 직전에 마지막 보고를 하려던 작업자가
   * 몇 초 늦었다는 이유로 거부당한다. 운영을 방해하는 가드는 결국 우회되므로, 관리자가
   * 설정한 이 유예를 시간창 검사에 함께 쓴다(ShiftSettingsTab 에서 저장, 운영값 10분).
   */
  shiftChangeBufferMinutes: number;
}

const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_SHIFT_A_START = '08:00';
const DEFAULT_SHIFT_B_START = '20:00';
const DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES = 10;

/**
 * **조회 실패와 설정 부재는 다른 것이다.**
 *
 * 이전 구현은 `if (error || !data) return defaults` 와 `catch { return defaults }` 로 둘을
 * 뭉갰다. 그래서 DB 가 잠깐 안 되기만 해도 "관리자가 08:00/20:00 으로 설정해 두었다" 고
 * 단언하는 것과 구분되지 않았고, 그 값으로 계산한 OEE 가 확정 저장됐다.
 *
 * 이 저장소는 같은 실수를 이미 두 번 문서화했다 — 비가동 `measured === null` 은 0 이 아니고,
 * NULL 지표는 0% 가 아니다. 조회 실패도 같다: **모르는 것을 아는 척하지 않는다.**
 *
 * - 조회 자체가 실패 → throw. 호출자가 500 으로 알린다.
 * - 조회는 됐는데 해당 키가 없음 → 기본값. 이것만이 기본값이 정당한 경우다.
 */
export async function getBusinessTimeConfig(): Promise<BusinessTimeConfig> {
  const defaults: BusinessTimeConfig = {
    timezone: DEFAULT_BUSINESS_TIMEZONE,
    shiftAStart: DEFAULT_SHIFT_A_START,
    shiftBStart: DEFAULT_SHIFT_B_START,
    shiftChangeBufferMinutes: DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES,
  };

  const { data, error } = await supabaseAdmin
    .from('system_settings')
    .select('category, setting_key, setting_value')
    .in('category', ['general', 'shift'])
    .eq('is_active', true);

  // 성공한 select 는 항상 배열을 준다. error 든 data 없음이든 "읽지 못했다" 는 뜻이다.
  if (error || !data) {
    throw new Error(
      `교대 시간 설정을 조회하지 못했습니다: ${error?.message ?? 'no data returned'}`
    );
  }

  const readRaw = (category: string, key: string): unknown => {
    const row = data.find(item => item.category === category && item.setting_key === key);
    return (row?.setting_value as { value?: unknown } | null | undefined)?.value;
  };

  const readValue = (category: string, key: string): string | undefined => {
    const value = readRaw(category, key);
    return typeof value === 'string' ? value : undefined;
  };

  // 버퍼는 jsonb 에 숫자로 저장된다({ "value": 10 }). 음수는 유예가 아니라 조기 마감이므로
  // 설정 실수로 보고 기본값을 쓴다. 0 은 "유예 없음" 이라는 유효한 의도라 그대로 존중한다.
  const readBufferMinutes = (): number => {
    const raw = readRaw('shift', 'shift_change_buffer_minutes');
    const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaults.shiftChangeBufferMinutes;
  };

  return {
    timezone: readValue('general', 'timezone') || defaults.timezone,
    shiftAStart: readValue('shift', 'shift_a_start') || defaults.shiftAStart,
    shiftBStart: readValue('shift', 'shift_b_start') || defaults.shiftBStart,
    shiftChangeBufferMinutes: readBufferMinutes(),
  };
}
