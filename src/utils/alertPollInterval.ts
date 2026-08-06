import { findSettingEntry } from '@/lib/settingsRegistry';

/**
 * `notification.alert_check_interval_seconds` 를 **타이머가 쓸 수 있는 밀리초**로 옮긴다.
 *
 * ## 왜 별도 모듈인가
 *
 * 이 값을 소비하는 폴링 지점이 둘이다 — 운영 알림(`useOperationalAlerts`)과 설비 상태 알림
 * (`NotificationContext`). 두 곳이 각자 해석하면 같은 설정에서 서로 다른 주기가 나온다.
 * 해석은 여기 한 곳만 둔다.
 *
 * ## 범위는 원장에서 가져온다 — 여기서 다시 적지 않는다
 *
 * 최소/최대/기본값은 `settingsRegistry` 가 이미 선언하고 있고, 저장 API 도 그 범위로 거부한다
 * (`validateSettingValue`). 같은 숫자를 여기 다시 적으면 원장을 고쳐도 이 파일은 따라오지
 * 않는 두 번째 진실이 생긴다.
 */
const ENTRY = findSettingEntry('notification', 'alert_check_interval_seconds');

/**
 * 원장에서 항목을 못 찾았을 때만 쓰는 비상값. 이 기능이 생기기 전의 고정 주기와 같은 60초다 —
 * 원장이 깨져도 알림 폴링은 **예전처럼** 돌아야 하기 때문이다.
 *
 * **여기서 예외를 던지지 않는다.** 이 모듈은 루트 레이아웃의 `NotificationProvider` 가
 * import 하므로, import 시점 예외는 알림 주기 하나 때문에 앱 전체를 하얗게 만든다.
 * 원장과의 어긋남은 프로덕션이 아니라 테스트에서 잡는다
 * (`src/utils/__tests__/alertPollInterval.test.ts` 가 아래 세 상수를 원장과 대조한다).
 */
const FALLBACK_SECONDS = 60;

export const ALERT_POLL_DEFAULT_SECONDS: number =
  typeof ENTRY?.defaultValue === 'number' ? ENTRY.defaultValue : FALLBACK_SECONDS;

export const ALERT_POLL_MIN_SECONDS: number = ENTRY?.validation?.min ?? ALERT_POLL_DEFAULT_SECONDS;
export const ALERT_POLL_MAX_SECONDS: number = ENTRY?.validation?.max ?? ALERT_POLL_DEFAULT_SECONDS;

/**
 * 설정값을 폴링 주기(ms)로 해석한다. **절대 0 이나 음수를 돌려주지 않는다.**
 *
 * `setInterval(fn, 0)` 은 API 를 상대로 한 바쁜 대기다. 그래서 해석 결과가 타이머에 닿기
 * 전에 여기서 막는다.
 *
 * 판정 규칙:
 *
 * 1. **숫자로 읽을 수 없거나 0 이하면 기본값을 쓴다.** 0·음수·`null`·`"abc"` 는 "더 빠르게"
 *    라는 선호가 아니라 **손상된 값**이다. 손상된 값을 최소값(10초)으로 끌어올리면 실수 하나가
 *    서버 부하 6배로 바뀐다 — 그건 안전한 쪽의 해석이 아니다.
 * 2. **양수면 원장 범위로 자른다.** 저장 경로는 범위를 강제하지만, 저장 검증이 생기기 전에
 *    들어간 행이나 DB 를 직접 고친 값은 그 검증을 지나지 않았다.
 *
 * 문자열도 받는다 — 설정은 전선 위에서 문자열이 되는 경로가 있고
 * (`settingsRegistry.validateSettingValue` 가 같은 이유로 문자열을 해석한다), 폴링 주기가
 * 그것 때문에 조용히 기본값으로 되돌아가면 설정이 안 먹는 것처럼 보인다.
 */
export function resolveAlertPollIntervalMs(raw: unknown): number {
  const seconds =
    typeof raw === 'number' ? raw
      : typeof raw === 'string' && raw.trim() !== '' ? Number(raw)
        : Number.NaN;

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return ALERT_POLL_DEFAULT_SECONDS * 1_000;
  }

  const clamped = Math.min(Math.max(seconds, ALERT_POLL_MIN_SECONDS), ALERT_POLL_MAX_SECONDS);
  return Math.round(clamped * 1_000);
}
