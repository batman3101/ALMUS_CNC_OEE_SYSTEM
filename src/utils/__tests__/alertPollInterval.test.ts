/**
 * 폴링 주기 해석 — `notification.alert_check_interval_seconds`
 *
 * 2026-08-06 감사: 라이브 설정이 120초인데 앱은 60초로 돌았다. 상수가 박혀 있었기 때문이다.
 * 여기서는 "설정값 → 타이머가 받는 밀리초"라는 변환 자체를 고정한다.
 */
import { findSettingEntry } from '@/lib/settingsRegistry';
import {
  ALERT_POLL_DEFAULT_SECONDS,
  ALERT_POLL_MAX_SECONDS,
  ALERT_POLL_MIN_SECONDS,
  resolveAlertPollIntervalMs,
} from '@/utils/alertPollInterval';

describe('resolveAlertPollIntervalMs', () => {
  it('범위와 기본값을 설정 원장에서 가져온다 (숫자를 따로 적지 않는다)', () => {
    // 원장이 이 항목을 잃으면 폴링은 비상값 60초로 조용히 되돌아간다.
    // 그 조용함을 여기서 깬다 — 프로덕션에서 예외를 던지는 대신 테스트가 실패한다.
    const entry = findSettingEntry('notification', 'alert_check_interval_seconds');
    expect(entry).toBeDefined();
    expect(ALERT_POLL_DEFAULT_SECONDS).toBe(entry?.defaultValue);
    expect(ALERT_POLL_MIN_SECONDS).toBe(entry?.validation?.min);
    expect(ALERT_POLL_MAX_SECONDS).toBe(entry?.validation?.max);
  });

  it('정상 범위의 값을 그대로 밀리초로 옮긴다', () => {
    // 라이브 값. 이것이 60_000 으로 나오면 감사가 지적한 그 버그다.
    expect(resolveAlertPollIntervalMs(120)).toBe(120_000);
    expect(resolveAlertPollIntervalMs(ALERT_POLL_MIN_SECONDS)).toBe(ALERT_POLL_MIN_SECONDS * 1_000);
    expect(resolveAlertPollIntervalMs(ALERT_POLL_MAX_SECONDS)).toBe(ALERT_POLL_MAX_SECONDS * 1_000);
  });

  it('전선 위의 문자열 숫자도 해석한다', () => {
    // 설정 저장 경로는 값을 문자열로 실어 보낸다(settingsRegistry 가 같은 이유로 해석한다).
    // 여기서 놓치면 설정을 바꿔도 주기가 기본값으로 되돌아가 "안 먹는" 것처럼 보인다.
    expect(resolveAlertPollIntervalMs('120')).toBe(120_000);
  });

  it('0·음수·쓰레기 값은 기본값으로 떨어진다 — 절대 0ms 타이머를 만들지 않는다', () => {
    const fallback = ALERT_POLL_DEFAULT_SECONDS * 1_000;
    for (const bad of [0, -1, -3_600, Number.NaN, Infinity, null, undefined, '', 'abc', {}, []]) {
      const resolved = resolveAlertPollIntervalMs(bad);
      expect(resolved).toBe(fallback);
      // setInterval(fn, 0) 은 API 를 상대로 한 바쁜 대기다. 어떤 입력에도 나오면 안 된다.
      expect(resolved).toBeGreaterThan(0);
    }
  });

  it('범위를 벗어난 양수는 원장 범위로 자른다', () => {
    expect(resolveAlertPollIntervalMs(ALERT_POLL_MIN_SECONDS - 1))
      .toBe(ALERT_POLL_MIN_SECONDS * 1_000);
    expect(resolveAlertPollIntervalMs(ALERT_POLL_MAX_SECONDS + 10_000))
      .toBe(ALERT_POLL_MAX_SECONDS * 1_000);
  });
});
