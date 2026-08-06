/**
 * 공장 표준시간대 해석 — 이 배치가 "어느 영업일" 을 대상으로 삼을지 정하는 단 하나의 근거.
 *
 * ══ 왜 별도 파일인가 ════════════════════════════════════════════════════
 *
 * index.ts 는 Deno Edge Function 이라 Jest 로 실행할 수 없다(`https://deno.land/...` import).
 * 그래서 **의존성이 하나도 없는** 순수 모듈로 떼어 둔다. Deno 는 `./plantTimezone.ts` 로,
 * Jest 는 확장자 없이 그대로 import 한다 — 같은 코드를 양쪽이 읽는다.
 *
 * ══ 왜 상수가 아니라 설정에서 읽는가 ════════════════════════════════════
 *
 * 이전 구현은 이렇게 적혀 있었다:
 *
 *     // 공장 표준시간대 (system_settings.general.timezone = 'Asia/Ho_Chi_Minh', ...)
 *     const PLANT_TIMEZONE = 'Asia/Ho_Chi_Minh';
 *
 * 그러나 `general.timezone` 은 **관리자가 UI 에서 바꿀 수 있는 설정**이다. 앱과 교대 계산은
 * 바뀐 값을 따라가는데(`src/lib/shiftConfig.ts`) 이 배치만 옛 값을 계속 쓴다. 그러면 배치는
 * **다른 날의 행**을 대상으로 삼는다. 오류가 아니라 "엉뚱한 날짜로 정상 동작" 이라 아무도
 * 알아채지 못한다. 게다가 위 주석은 설정값을 **단언**하고 있어서, 읽는 사람에게는 어긋남이
 * 아예 보이지 않는다.
 *
 * 그래서 값을 **단언하지 않고 유도한다.** 지금 운영값이 마침 'Asia/Ho_Chi_Minh' 라는 사실은
 * 이 결함을 무해하게 만드는 것이 아니라, 발현 시점을 관리자의 다음 편집으로 미룰 뿐이다.
 *
 * ══ 모르는 값을 그럴듯한 값으로 바꾸지 않는다 ═══════════════════════════
 *
 * `Intl.DateTimeFormat` 에 인식되지 않는 시간대를 주면 `RangeError` 를 던지지만, ICU 데이터가
 * 없는 런타임은 조용히 UTC 로 해석하기도 한다. UTC 는 공장 시간(UTC+7)보다 7시간 뒤라
 * **07:00 이전에는 하루 전 날짜**가 나온다. 즉 "그럴듯해 보이는 틀린 날짜" 다.
 * 이 저장소가 이미 두 번 문서화한 실수와 같은 종류다(비가동 `null` 은 0 이 아니고,
 * NULL 지표는 0% 가 아니다). 그러므로:
 *
 *   - 설정을 **읽지 못했다**(쿼리 실패) 또는 **행이 없다**  → 기본값으로 진행하되 **보고한다**.
 *   - 설정은 있는데 **시간대로 쓸 수 없는 값**이다          → 기본값으로 때우지 않고 **거부한다**.
 *
 * 앞의 둘과 "설정값이 마침 기본값과 같다" 는 서로 다른 사실이므로 응답에서 구분된다.
 */

/** 설정을 읽지 못했을 때만 쓰는 값. 운영 설정값과 우연히 같더라도 출처가 다르다. */
export const DEFAULT_PLANT_TIMEZONE = 'Asia/Ho_Chi_Minh';

export type PlantTimezoneFallbackReason =
  /** 조회는 성공했지만 general.timezone 행이 없다(또는 is_active=false). */
  | 'setting_missing'
  /** 조회 자체가 실패했다. 설정이 무엇인지 알 수 없다. */
  | 'settings_unreadable';

export type PlantTimezoneResolution =
  | { status: 'configured'; timezone: string }
  | {
      status: 'fallback';
      timezone: string;
      reason: PlantTimezoneFallbackReason;
      detail: string;
    }
  | { status: 'invalid'; configured: string; detail: string };

/** system_settings 한 행의 조회 결과. 쿼리는 호출자가 하고 이 모듈은 해석만 한다. */
export interface PlantTimezoneSettingRead {
  /** `system_settings.setting_value` (jsonb, 운영 형태는 `{ "value": "Asia/Ho_Chi_Minh" }`). */
  settingValue?: unknown;
  /** 조회 자체가 실패했을 때의 메시지. 성공이면 null/undefined. */
  queryError?: string | null;
}

/**
 * UTC 와 동의어인 이름들(소문자). 이 목록은 "요청한 이름이 UTC 계열인가" 를 판별하는 데만
 * 쓰인다 — 아래 `isSupportedTimeZone` 의 2차 방어선이 정상적인 UTC 설정을 거부하지 않도록.
 */
const UTC_ALIASES: ReadonlySet<string> = new Set([
  'utc', 'universal', 'zulu', 'z', 'gmt', 'gmt0', 'gmt+0', 'gmt-0', 'greenwich',
  'etc/utc', 'etc/universal', 'etc/zulu', 'etc/gmt', 'etc/gmt0', 'etc/gmt+0', 'etc/gmt-0',
  'etc/greenwich', '+00:00', '-00:00', '+0000', '-0000',
]);

/**
 * 런타임이 이 시간대를 **실제로 인식하는지** 확인한다.
 *
 * 1차 방어선: 인식되지 않는 이름이면 `Intl.DateTimeFormat` 이 `RangeError` 를 던진다.
 * 2차 방어선: 던지지 않고 조용히 UTC 로 떨어지는 런타임에 대비해, 요청한 이름이 UTC 계열이
 *            아닌데 UTC 로 풀렸으면 "인식되지 않았다" 로 본다.
 *
 * 별칭 해석(`Asia/Saigon` → `Asia/Ho_Chi_Minh` 등)은 정상이므로 이름 일치를 요구하지 않는다.
 * 오직 "UTC 로의 조용한 강등" 만 잡는다.
 */
export function isSupportedTimeZone(timezone: string): boolean {
  if (typeof timezone !== 'string' || timezone.trim() === '') return false;

  const requested = timezone.trim();
  let resolved: string | undefined;

  try {
    resolved = new Intl.DateTimeFormat('en-CA', { timeZone: requested })
      .resolvedOptions().timeZone;
  } catch (_e) {
    return false;
  }

  if (!resolved) return false;

  if (UTC_ALIASES.has(resolved.toLowerCase()) && !UTC_ALIASES.has(requested.toLowerCase())) {
    return false;
  }

  return true;
}

/** 오류 메시지에 원본 값을 넣되 로그를 뒤덮지 않도록 자른다. */
function preview(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

type ConfiguredString =
  | { kind: 'absent' }
  | { kind: 'string'; value: string }
  | { kind: 'malformed'; preview: string };

/**
 * jsonb 에서 문자열을 꺼낸다. 운영 형태는 `{ "value": "Asia/Ho_Chi_Minh" }` 이고,
 * 문자열이 그대로 저장된 형태도 모호함 없이 읽을 수 있으므로 함께 받는다.
 * 그 밖의 모양(숫자, 배열, `{ value: 42 }` 등)은 **모양이 어긋난 것**이지 부재가 아니다.
 * 부재로 뭉개면 기본값으로 조용히 진행하게 되므로 구분해서 돌려준다.
 */
function readConfiguredString(settingValue: unknown): ConfiguredString {
  if (settingValue === undefined || settingValue === null) return { kind: 'absent' };

  if (typeof settingValue === 'string') return { kind: 'string', value: settingValue };

  if (typeof settingValue === 'object') {
    const inner = (settingValue as { value?: unknown }).value;
    if (inner === undefined || inner === null) return { kind: 'absent' };
    if (typeof inner === 'string') return { kind: 'string', value: inner };
    return { kind: 'malformed', preview: preview(inner) };
  }

  return { kind: 'malformed', preview: preview(settingValue) };
}

/**
 * 조회 결과를 시간대 결정으로 바꾼다.
 *
 * 빈 문자열은 "관리자가 값을 비워 둔 것" 이므로 부재와 같이 다룬다
 * (`src/lib/shiftConfig.ts` 의 `readValue(...) || defaults` 와 같은 취급).
 */
export function resolvePlantTimezone(read: PlantTimezoneSettingRead): PlantTimezoneResolution {
  if (read.queryError) {
    return {
      status: 'fallback',
      timezone: DEFAULT_PLANT_TIMEZONE,
      reason: 'settings_unreadable',
      detail: `system_settings 조회 실패: ${read.queryError}`,
    };
  }

  const configured = readConfiguredString(read.settingValue);

  if (configured.kind === 'malformed') {
    return {
      status: 'invalid',
      configured: configured.preview,
      detail: `general.timezone 이 문자열이 아닙니다: ${configured.preview}`,
    };
  }

  if (configured.kind === 'absent' || configured.value.trim() === '') {
    return {
      status: 'fallback',
      timezone: DEFAULT_PLANT_TIMEZONE,
      reason: 'setting_missing',
      detail: 'system_settings 에 활성화된 general.timezone 행이 없습니다',
    };
  }

  const timezone = configured.value.trim();

  if (!isSupportedTimeZone(timezone)) {
    return {
      status: 'invalid',
      configured: preview(timezone),
      detail: `general.timezone '${preview(timezone)}' 은(는) 인식되는 IANA 시간대가 아닙니다`,
    };
  }

  return { status: 'configured', timezone };
}

/**
 * 주어진 시각을 해당 시간대의 'YYYY-MM-DD' 로 바꾼다. 이 값이 배치의 대상 영업일이다.
 *
 * `formatToParts` 로 조립한다 — 로케일 축약형이 바뀌어도 형식이 흔들리지 않게.
 * 인식할 수 없는 시간대나 유효하지 않은 Date 는 **던진다.** 여기서 UTC 로 대신 답하면
 * 07:00 이전 호출이 하루 전 날짜를 조용히 돌려주고, 그 날짜로 배치가 정상 종료된다.
 */
export function businessDateInTimezone(instant: Date, timezone: string): string {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new Error('businessDateInTimezone: instant 가 유효한 Date 가 아닙니다');
  }

  if (!isSupportedTimeZone(timezone)) {
    throw new Error(`businessDateInTimezone: 인식할 수 없는 시간대 '${preview(timezone)}'`);
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const part = (type: 'year' | 'month' | 'day'): string =>
    parts.find(p => p.type === type)?.value ?? '';

  const [year, month, day] = [part('year'), part('month'), part('day')];

  if (!year || !month || !day) {
    throw new Error(`businessDateInTimezone: 날짜를 조립하지 못했습니다 (timezone='${preview(timezone)}')`);
  }

  return `${year}-${month}-${day}`;
}
