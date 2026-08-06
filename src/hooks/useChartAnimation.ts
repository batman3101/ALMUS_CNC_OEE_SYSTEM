'use client';

import { useMemo } from 'react';
import { useSystemSettings } from './useSystemSettings';

/**
 * `display.chart_animation_enabled` 를 **차트 라이브러리가 실제로 읽는 값**으로 옮긴다.
 *
 * ■ 왜 훅 하나로 모으는가
 *   이 저장소에는 차트가 Chart.js(react-chartjs-2)와 Recharts 두 계열로 나뉘어 있고,
 *   애니메이션을 끄는 방법이 서로 다르다 — Chart.js 는 `options.animation: false`,
 *   Recharts 는 시리즈마다 `isAnimationActive={false}`. 컴포넌트마다 설정을 직접 읽으면
 *   그때그때 다른 방식으로 옮겨 적게 되고, 한쪽 계열만 반영된 채로 "적용됐다"고 믿게 된다.
 *   변환 규칙을 여기 한 곳에만 둔다.
 *
 * ■ 왜 `chartJs` 가 `false | undefined` 인가
 *   Chart.js 에서 애니메이션 "켜짐"은 `animation: true` 가 아니라 **옵션을 주지 않는 것**이다.
 *   기본 duration·easing 이 그때 적용된다. `true` 를 넣으면 타입도 맞지 않고 기본 스펙과도
 *   어긋나므로, 켜짐은 `undefined`(= 라이브러리 기본값)로 표현한다.
 *
 * ■ 값이 아직 도착하지 않았을 때
 *   `getDisplaySettings()` 가 설정 미로딩 구간에서 기본값 `true` 를 돌려주므로, 초기 렌더는
 *   "애니메이션 켜짐"으로 그려진다. 설정이 도착하면 `false` 로 바뀌고 이후 렌더부터 적용된다.
 *   사이드바 초기 상태(`display.sidebar_collapsed`)와 달리 여기서는 1회 하이드레이션이
 *   필요 없다 — 이 값은 사용자가 화면에서 뒤집을 수 있는 상태가 아니라 매 렌더 파생값이라,
 *   "사용자의 선택을 덮어쓸" 여지가 애초에 없다.
 */
export interface ChartAnimationSettings {
  /** 애니메이션 사용 여부 (설정 원본) */
  enabled: boolean;
  /** Chart.js `options.animation` 에 그대로 넣는다. */
  chartJs: false | undefined;
  /** Recharts 시리즈의 `isAnimationActive` 에 그대로 넣는다. */
  recharts: boolean;
}

export function useChartAnimation(): ChartAnimationSettings {
  const { getDisplaySettings } = useSystemSettings();
  const enabled = getDisplaySettings().chartAnimation !== false;

  return useMemo<ChartAnimationSettings>(() => ({
    enabled,
    chartJs: enabled ? undefined : false,
    recharts: enabled,
  }), [enabled]);
}
