import React from 'react';
import { renderHook } from '@testing-library/react';
import { useChartAnimation } from '../useChartAnimation';
import type { SettingCategory, SettingKey } from '@/types/systemSettings';

/**
 * `display.chart_animation_enabled` → 차트 라이브러리 값 변환 규칙.
 *
 * 여기서 **설정 저장소 쪽을 가짜로** 두는 이유는, 이 훅이 지켜야 하는 명제가 "설정 키
 * 하나가 두 라이브러리의 서로 다른 스위치로 옮겨진다"는 변환 규칙 자체이기 때문이다.
 * 화면에서 실제로 그 값이 차트에 도달하는지는 컴포넌트 쪽 검사
 * (`src/components/oee/__tests__/chartAnimationSetting.test.tsx`)가 따로 본다 — 두 검사를
 * 합치면 설정 행에서 캔버스까지 끊긴 데가 없다.
 *
 * 가짜를 `@/contexts/SystemSettingsContext` 에 두는 것도 의도적이다. 한 칸 위인
 * `@/hooks/useSystemSettings` 를 가짜로 두면 `getDisplaySettings()` 의 기본값(`?? true`)이
 * 검사에서 빠져나가, 설정이 아직 없을 때 애니메이션이 꺼진 채로 그려지는 회귀를 못 잡는다.
 */

const mockSettings = jest.fn<Record<string, unknown>, []>();

jest.mock('@/contexts/SystemSettingsContext', () => ({
  useSystemSettings: () => ({
    settings: { display: mockSettings() },
    isLoading: false,
    error: null,
    getSetting: <C extends SettingCategory, K extends SettingKey<C>>(category: C, key: K) => {
      if (category !== 'display') return null;
      return (mockSettings() as Record<string, unknown>)[key as string] ?? null;
    },
  }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>;

const renderWith = (display: Record<string, unknown>) => {
  mockSettings.mockReturnValue(display);
  return renderHook(() => useChartAnimation(), { wrapper });
};

describe('useChartAnimation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('설정이 false 면 Chart.js 는 animation:false, Recharts 는 isAnimationActive:false 를 받는다', () => {
    const { result } = renderWith({ chart_animation_enabled: false });
    expect(result.current.enabled).toBe(false);
    expect(result.current.chartJs).toBe(false);
    expect(result.current.recharts).toBe(false);
  });

  it('설정이 true 면 Chart.js 는 옵션을 주지 않고(undefined) Recharts 는 true 를 받는다', () => {
    // Chart.js 에서 "켜짐"은 `animation: true` 가 아니라 옵션 미지정이다. `true` 를 넣으면
    // 기본 duration/easing 스펙과 어긋난다.
    const { result } = renderWith({ chart_animation_enabled: true });
    expect(result.current.enabled).toBe(true);
    expect(result.current.chartJs).toBeUndefined();
    expect(result.current.recharts).toBe(true);
  });

  it('설정이 아직 없으면 애니메이션은 켜진 상태로 취급한다', () => {
    // 값이 도착하기 전 몇 프레임 동안 애니메이션이 꺼졌다 켜지면 차트가 눈에 띄게 튄다.
    // 기본값은 설정 폼의 기본값(`chart_animation_enabled: true`)과 같아야 한다.
    const { result } = renderWith({});
    expect(result.current.enabled).toBe(true);
    expect(result.current.chartJs).toBeUndefined();
    expect(result.current.recharts).toBe(true);
  });

  it('같은 설정에서는 매 렌더 같은 객체를 돌려준다', () => {
    // 차트 옵션이 매 렌더 새 객체가 되면 Chart.js 가 불필요하게 다시 그린다.
    const { result, rerender } = renderWith({ chart_animation_enabled: false });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
