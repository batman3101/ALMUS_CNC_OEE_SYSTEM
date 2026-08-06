import fs from 'fs';
import path from 'path';

import {
  businessDateInTimezone,
  DEFAULT_PLANT_TIMEZONE,
  isSupportedTimeZone,
  resolvePlantTimezone,
} from '../daily-oee-aggregation/plantTimezone';

/**
 * `daily-oee-aggregation` 이 대상 영업일을 고르는 근거(공장 표준시간대) 회귀 검사.
 *
 * 결함(2026-08-06): index.ts 가 'Asia/Ho_Chi_Minh' 를 상수로 박아 두고, 주석으로
 * `system_settings.general.timezone` 이 그 값이라고 **단언**했다. 그 설정은 관리자가 UI 에서
 * 바꿀 수 있으므로, 바꾸는 순간 앱은 새 시간대를, 이 배치만 옛 시간대를 쓴다 —
 * 오류 없이 **다른 날의 행**을 대상으로 삼는다.
 *
 * 그래서 이 파일은 두 층으로 나뉜다.
 *
 *  1. 순수 로직 — "이 시간대일 때 배치가 고르는 날짜는 무엇인가" 를 직접 단언한다.
 *     getter 가 호출되었는지가 아니라 **결과 날짜**를 본다.
 *  2. 배선 — index.ts 가 실제로 그 로직을 쓰는지 소스로 확인한다. Deno Edge Function 이라
 *     Jest 로 실행할 수 없어, `machineStateLockProtocol.test.ts` / `dailyOeeAggregationAuthz.test.ts`
 *     와 같은 소스 스캔 방식을 쓴다. 1층만 있으면 index.ts 를 상수로 되돌려도 전부 통과한다.
 */

/**
 * 이 시각을 기준으로 각 시간대의 날짜가 갈린다.
 *   UTC              2026-08-06 22:30
 *   Asia/Ho_Chi_Minh 2026-08-07 05:30  (+7)
 *   America/Los_Angeles 2026-08-06 15:30 (-7)
 * 즉 시간대를 잘못 고르면 **하루가 통째로 어긋난다.**
 */
const INSTANT = new Date('2026-08-06T22:30:00Z');

/** 운영 저장 형태: jsonb `{ "value": "Asia/Ho_Chi_Minh" }` (2026-08-06 실측). */
const settingValue = (value: unknown) => ({ value });

/** 배치가 실제로 고르는 날짜. 이것이 이 결함의 관측 가능한 결과다. */
function businessDateFrom(read: Parameters<typeof resolvePlantTimezone>[0]): string {
  const resolution = resolvePlantTimezone(read);
  if (resolution.status === 'invalid') {
    throw new Error(`거부됨: ${resolution.detail}`);
  }
  return businessDateInTimezone(INSTANT, resolution.timezone);
}

describe('공장 표준시간대 해석 — 대상 영업일', () => {
  it('설정된 시간대로 날짜를 정한다', () => {
    expect(businessDateFrom({ settingValue: settingValue('Asia/Ho_Chi_Minh') })).toBe('2026-08-07');
  });

  it('관리자가 시간대를 바꾸면 배치가 고르는 날짜도 바뀐다', () => {
    // 결함의 본체. 상수로 박아 두면 이 두 값이 같아진다.
    expect(businessDateFrom({ settingValue: settingValue('America/Los_Angeles') })).toBe('2026-08-06');
    expect(businessDateFrom({ settingValue: settingValue('UTC') })).toBe('2026-08-06');
    expect(businessDateFrom({ settingValue: settingValue('Pacific/Kiritimati') })).toBe('2026-08-07');
  });

  it('문자열이 그대로 저장된 형태(jsonb string)도 읽는다', () => {
    expect(businessDateFrom({ settingValue: 'America/Los_Angeles' })).toBe('2026-08-06');
  });

  it('앞뒤 공백은 무시한다', () => {
    const resolution = resolvePlantTimezone({ settingValue: settingValue('  Asia/Ho_Chi_Minh  ') });
    expect(resolution).toEqual({ status: 'configured', timezone: 'Asia/Ho_Chi_Minh' });
  });
});

describe('폴백 — 기본값을 쓴 사실이 드러난다', () => {
  it('행이 없으면 기본 시간대로 진행하고 그 사실을 보고한다', () => {
    const resolution = resolvePlantTimezone({ settingValue: undefined });

    expect(resolution.status).toBe('fallback');
    if (resolution.status !== 'fallback') throw new Error('unreachable');
    expect(resolution.timezone).toBe(DEFAULT_PLANT_TIMEZONE);
    expect(resolution.reason).toBe('setting_missing');
    expect(resolution.detail).toContain('general.timezone');

    // 기본값이 실제로 옛 상수와 같은 날짜를 고르는지까지 확인한다.
    expect(businessDateInTimezone(INSTANT, resolution.timezone)).toBe('2026-08-07');
  });

  it('빈 문자열은 "설정하지 않음" 으로 본다', () => {
    const resolution = resolvePlantTimezone({ settingValue: settingValue('   ') });

    expect(resolution.status).toBe('fallback');
    if (resolution.status !== 'fallback') throw new Error('unreachable');
    expect(resolution.reason).toBe('setting_missing');
  });

  it('조회 실패는 행 부재와 다른 이유로 구분된다', () => {
    // "못 읽었다" 와 "읽었는데 없다" 는 다른 사실이다. 둘 다 기본값으로 가지만 이유가 남는다.
    const resolution = resolvePlantTimezone({ queryError: 'connection reset' });

    expect(resolution.status).toBe('fallback');
    if (resolution.status !== 'fallback') throw new Error('unreachable');
    expect(resolution.reason).toBe('settings_unreadable');
    expect(resolution.detail).toContain('connection reset');
    expect(resolution.timezone).toBe(DEFAULT_PLANT_TIMEZONE);
  });

  it('설정값이 기본값과 같아도 폴백과는 구분된다', () => {
    // 시간대 문자열만 보면 두 경우가 똑같다. status 가 그 구분을 지고 있다.
    const configured = resolvePlantTimezone({ settingValue: settingValue(DEFAULT_PLANT_TIMEZONE) });
    const fallback = resolvePlantTimezone({ settingValue: null });

    expect(configured.status).toBe('configured');
    expect(fallback.status).toBe('fallback');
    expect(configured.timezone).toBe(fallback.timezone);
  });
});

describe('거부 — 쓸 수 없는 값을 조용히 UTC 나 기본값으로 바꾸지 않는다', () => {
  it('인식되지 않는 시간대는 invalid 로 거부한다', () => {
    const resolution = resolvePlantTimezone({ settingValue: settingValue('Mars/Olympus_Mons') });

    expect(resolution.status).toBe('invalid');
    if (resolution.status !== 'invalid') throw new Error('unreachable');
    expect(resolution.configured).toBe('Mars/Olympus_Mons');
    // 기본값으로 때우지 않는다 — 시간대 자체를 돌려주지 않는다.
    expect(resolution).not.toHaveProperty('timezone');
  });

  it('거부는 UTC 로의 조용한 강등과 구분된다', () => {
    // UTC 로 떨어졌다면 이 시각에서 '2026-08-06' 이 나오고 배치는 성공으로 끝났을 것이다.
    expect(() => businessDateFrom({ settingValue: settingValue('Not/AZone') })).toThrow(/거부됨/);
  });

  it('문자열이 아닌 값은 부재가 아니라 모양이 어긋난 것으로 본다', () => {
    // 부재로 뭉개면 기본값으로 조용히 진행하게 된다.
    for (const bad of [settingValue(42), settingValue(['Asia/Ho_Chi_Minh']), 42, true]) {
      const resolution = resolvePlantTimezone({ settingValue: bad });
      expect(resolution.status).toBe('invalid');
    }
  });

  it('businessDateInTimezone 은 인식할 수 없는 시간대에 날짜를 지어내지 않는다', () => {
    expect(() => businessDateInTimezone(INSTANT, 'Not/AZone')).toThrow(/인식할 수 없는 시간대/);
    expect(() => businessDateInTimezone(INSTANT, '')).toThrow(/인식할 수 없는 시간대/);
  });

  it('businessDateInTimezone 은 유효하지 않은 Date 에 날짜를 지어내지 않는다', () => {
    expect(() => businessDateInTimezone(new Date('nonsense'), DEFAULT_PLANT_TIMEZONE))
      .toThrow(/유효한 Date/);
  });

  it('정상적인 UTC 설정은 거부하지 않는다', () => {
    // "UTC 로의 조용한 강등" 을 잡는 2차 방어선이 진짜 UTC 설정까지 막으면 안 된다.
    for (const utcName of ['UTC', 'Etc/UTC', 'utc']) {
      expect(isSupportedTimeZone(utcName)).toBe(true);
      expect(resolvePlantTimezone({ settingValue: settingValue(utcName) }).status).toBe('configured');
    }
  });

  it('별칭 시간대는 이름이 달라져도 통과한다', () => {
    // 런타임이 Asia/Saigon 을 Asia/Ho_Chi_Minh 로 정규화해도 유효한 설정이다.
    expect(isSupportedTimeZone('Asia/Saigon')).toBe(true);
    expect(businessDateFrom({ settingValue: settingValue('Asia/Saigon') })).toBe('2026-08-07');
  });
});

describe('배선 — index.ts 가 실제로 이 해석기를 쓴다', () => {
  const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '..', 'daily-oee-aggregation', 'index.ts'),
    'utf8'
  );

  it('소스를 실제로 읽는다 (탐지기 자체가 죽지 않았는지)', () => {
    expect(SOURCE).toContain('serve(async (req)');
    expect(SOURCE.length).toBeGreaterThan(1000);
  });

  it('해석기를 import 한다', () => {
    expect(SOURCE).toMatch(/from\s+'\.\/plantTimezone\.ts'/);
    expect(SOURCE).toMatch(/resolvePlantTimezone/);
    expect(SOURCE).toMatch(/businessDateInTimezone\(\s*new Date\(\)/);
  });

  it('시간대를 설정에서 읽는다', () => {
    expect(SOURCE).toMatch(/\.eq\(\s*'category'\s*,\s*'general'\s*\)/);
    expect(SOURCE).toMatch(/\.eq\(\s*'setting_key'\s*,\s*'timezone'\s*\)/);
  });

  it('시간대를 소스에 다시 박아 두지 않는다', () => {
    // 되돌림 회귀 감시. 상수도, 상수를 쓰는 포맷터도 index.ts 에 있으면 안 된다.
    expect(SOURCE).not.toMatch(/const\s+PLANT_TIMEZONE\s*=/);
    expect(SOURCE).not.toMatch(/new\s+Intl\.DateTimeFormat/);
    expect(SOURCE).not.toMatch(/timeZone\s*:/);
  });

  it('쓸 수 없는 시간대면 거부한다', () => {
    expect(SOURCE).toMatch(/invalid_plant_timezone/);
    expect(SOURCE).toMatch(/timezoneResolution\.status\s*===\s*'invalid'/);
  });

  it('폴백 여부를 응답에 싣는다', () => {
    expect(SOURCE).toMatch(/plant_timezone_source/);
    expect(SOURCE).toMatch(/plant_timezone_fallback_reason/);
  });

  it('시간대 조회는 인가 뒤, 대상 데이터 조회 앞에 온다', () => {
    // 거부할 호출자를 위해 DB 를 건드리지 않는다. 그리고 날짜를 정하기 전에 읽어야 한다.
    const authzAt = SOURCE.indexOf("req.headers.get('Authorization')");
    const settingsAt = SOURCE.indexOf("from('system_settings')");
    const recordsAt = SOURCE.indexOf("from('production_records')");

    expect(authzAt).toBeGreaterThan(-1);
    expect(settingsAt).toBeGreaterThan(-1);
    expect(recordsAt).toBeGreaterThan(-1);
    expect(authzAt).toBeLessThan(settingsAt);
    expect(settingsAt).toBeLessThan(recordsAt);
  });
});
