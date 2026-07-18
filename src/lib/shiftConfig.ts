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
}

const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_SHIFT_A_START = '08:00';
const DEFAULT_SHIFT_B_START = '20:00';

export async function getBusinessTimeConfig(): Promise<BusinessTimeConfig> {
  const defaults: BusinessTimeConfig = {
    timezone: DEFAULT_BUSINESS_TIMEZONE,
    shiftAStart: DEFAULT_SHIFT_A_START,
    shiftBStart: DEFAULT_SHIFT_B_START,
  };
  try {
    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .select('category, setting_key, setting_value')
      .in('category', ['general', 'shift'])
      .eq('is_active', true);
    if (error || !data) return defaults;
    const readValue = (category: string, key: string): string | undefined => {
      const row = data.find(item => item.category === category && item.setting_key === key);
      const value = row?.setting_value as { value?: unknown } | null | undefined;
      return typeof value?.value === 'string' ? value.value : undefined;
    };
    return {
      timezone: readValue('general', 'timezone') || defaults.timezone,
      shiftAStart: readValue('shift', 'shift_a_start') || defaults.shiftAStart,
      shiftBStart: readValue('shift', 'shift_b_start') || defaults.shiftBStart,
    };
  } catch {
    return defaults;
  }
}
