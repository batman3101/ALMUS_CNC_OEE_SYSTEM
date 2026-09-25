import { getBreakTimeMinutes } from '@/lib/plannedRuntime';
import { getBusinessTimeConfig } from '@/lib/shiftConfig';
import type { ForecastCapacityPolicy } from '@/types/forecast';

/** Same authenticated factory settings as OEE; unavailable is never a made-up default. */
export async function loadForecastCapacityPolicy(factoryId: string): Promise<ForecastCapacityPolicy> {
  try {
    const [config, breakMinutes] = await Promise.all([getBusinessTimeConfig(factoryId), getBreakTimeMinutes(factoryId)]);
    const clock = /^(?:[01]?\d|2[0-3]):[0-5]\d$/;
    if (!clock.test(config.shiftAStart) || !clock.test(config.shiftBStart) || config.shiftAStart === config.shiftBStart ||
        !Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes > 1440) return { status: 'unavailable' };
    new Intl.DateTimeFormat('en', { timeZone: config.timezone }).format();
    return { status: 'available', source: 'oee_settings', timezone: config.timezone, shiftAStart: config.shiftAStart, shiftBStart: config.shiftBStart, breakMinutes, separateEfficiencyMultiplier: false };
  } catch { return { status: 'unavailable' }; }
}
