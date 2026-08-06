'use client';

import { useMemo } from 'react';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { resolveAlertPollIntervalMs } from '@/utils/alertPollInterval';

/**
 * 알림 설정(`system_settings.notification`)을 **소비 가능한 형태**로 돌려주는 한 곳.
 *
 * 2026-08-06 감사에서 이 카테고리의 네 설정이 "저장은 되는데 아무 일도 하지 않는" 상태로
 * 확인됐다. 라이브 값이 120초인데 앱은 60초로 돌고 있었던 것이 그 증거다(기본값 우연 일치가
 * 아니었다).
 *
 * 읽기 자체는 `useSystemSettings().getNotificationSettings()` 가 이미 올바르게 하고 있었고
 * 호출자만 없었다. 그래서 새 읽기 경로를 만들지 않고 그것을 쓴다.
 *
 * ## 값은 **런타임에 바뀐다**
 *
 * `SystemSettingsContext` 는 Realtime 신호를 받아 설정을 다시 읽는다. 그래서 여기서 나온
 * 값도 마운트 시점 스냅샷이 아니라 살아 있는 값이고, 타이머를 거는 쪽은 이 값이 바뀌면
 * **다시 걸어야** 한다. 그러라고 원시 타입만 돌려준다 — `useEffect` 의존성에 그대로 넣으면
 * 값이 실제로 바뀔 때만 effect 가 다시 돈다.
 */
export interface NotificationPreferences {
  /** 폴링 주기(ms). 원장 범위로 잘린 값이며 항상 양수다. */
  readonly pollIntervalMs: number;
  /** OS 브라우저 알림을 띄워도 되는가. 권한 상태는 **별개**이며 여기 섞지 않는다. */
  readonly browserEnabled: boolean;
  /** 알림음을 재생해도 되는가. */
  readonly soundEnabled: boolean;
}

export function useNotificationPreferences(): NotificationPreferences {
  const { getNotificationSettings } = useSystemSettings();
  const { checkInterval, browser, sound } = getNotificationSettings();

  return useMemo(() => ({
    pollIntervalMs: resolveAlertPollIntervalMs(checkInterval),
    // 설정이 아직 로드되지 않았으면 `getNotificationSettings` 가 false 를 준다.
    // 그 방향이 맞다 — 모르는 상태에서 소리부터 내는 것보다 조용한 편이 낫고,
    // 로그인 직후 설정이 도착하면 값이 바뀌면서 자연히 켜진다.
    browserEnabled: browser === true,
    soundEnabled: sound === true,
  }), [checkInterval, browser, sound]);
}
