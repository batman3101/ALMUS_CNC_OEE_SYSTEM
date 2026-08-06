import React from 'react';
import { render } from '@testing-library/react';
import type { SettingCategory, SettingKey } from '@/types/systemSettings';
import type { OEEMetrics, ProductionData, DowntimeData } from '@/types';

/**
 * `display.chart_animation_enabled` 가 **차트까지 실제로 도달하는지** 본다.
 *
 * ■ 왜 소스 검사가 아니라 렌더링인가
 *   이 저장소는 "문자열이 있으니 배선됐다"는 검사에 이미 두 번 속았다
 *   (`appLayoutAccessGate`, `sidebarMenuTiers` 의 머리말 참조). import 줄에 이름이 남아
 *   있으면 grep 은 통과하고, 옵션에서 그 값을 빼도 아무 검사가 깨지지 않는다. 그래서
 *   차트 라이브러리 자리에 기록용 대역을 세우고 **라이브러리가 받은 props** 를 본다 —
 *   컴포넌트에서 `animation` / `isAnimationActive` 를 지우면 이 검사는 반드시 깨진다.
 *
 * ■ 왜 12개를 전부 렌더링하는가
 *   설정 하나가 "차트에 적용된다"고 말하려면 한 개가 아니라 **전부**가 따라야 한다.
 *   한 컴포넌트만 검사하면 나중에 추가되는 차트가 조용히 빠진 채로 "적용됨"이 유지된다.
 *   설정 저장소부터 실제 훅 체인을 그대로 태우므로, 중간의 어느 고리가 끊겨도 잡힌다.
 */

// ── 차트 라이브러리 대역 ───────────────────────────────────────────────────
// Chart.js 는 jsdom 에 없는 canvas 를 요구하므로 어차피 대역이 필요하다.
const mockChartJsOptions: Array<Record<string, unknown>> = [];
const mockRechartsSeries: Array<{ type: string; props: Record<string, unknown> }> = [];

jest.mock('react-chartjs-2', () => {
  const record = (kind: string) => (props: { options?: Record<string, unknown> }) => {
    mockChartJsOptions.push({ kind, ...(props.options ?? {}) });
    return null;
  };
  return { Line: record('line'), Bar: record('bar'), Doughnut: record('doughnut') };
});

jest.mock('recharts', () => {
  const ReactLib = jest.requireActual<typeof import('react')>('react');

  /** 시리즈(= 애니메이션 스위치를 갖는 요소)는 props 를 기록한다. */
  const series = (type: string) => {
    const C = (props: Record<string, unknown>) => {
      mockRechartsSeries.push({ type, props });
      return ReactLib.createElement('div', null, props.children as React.ReactNode);
    };
    C.displayName = type;
    return C;
  };
  /** 나머지는 자식만 통과시키는 껍데기. */
  const passthrough = (name: string) => {
    const C = (props: { children?: React.ReactNode }) =>
      ReactLib.createElement('div', null, props.children);
    C.displayName = name;
    return C;
  };

  return {
    Bar: series('Bar'),
    Line: series('Line'),
    Pie: series('Pie'),
    Area: series('Area'),
    BarChart: passthrough('BarChart'),
    LineChart: passthrough('LineChart'),
    PieChart: passthrough('PieChart'),
    ResponsiveContainer: passthrough('ResponsiveContainer'),
    Cell: passthrough('Cell'),
    XAxis: passthrough('XAxis'),
    YAxis: passthrough('YAxis'),
    CartesianGrid: passthrough('CartesianGrid'),
    Tooltip: passthrough('Tooltip'),
    Legend: passthrough('Legend'),
    ReferenceLine: passthrough('ReferenceLine'),
  };
});

// ── 주변 의존성 ────────────────────────────────────────────────────────────
const translation = {
  t: (key: string) => key,
  language: 'ko',
  i18n: { language: 'ko', changeLanguage: jest.fn() },
};

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => translation,
  useDashboardTranslation: () => translation,
  useCommonTranslation: () => translation,
}));

const CHART_ROWS = [
  { date: '2026-08-01', availability: 0.9, performance: 0.95, quality: 0.99, oee: 0.846 },
  { date: '2026-08-02', availability: 0.8, performance: 0.92, quality: 0.98, oee: 0.721 },
];

jest.mock('@/hooks/useOEEChartData', () => ({
  useOEEChartData: () => ({
    chartData: CHART_ROWS,
    loading: false,
    error: null,
    period: 'daily',
    dateRange: null,
    handlePeriodChange: jest.fn(),
    handleDateRangeChange: jest.fn(),
    refreshData: jest.fn(),
  }),
}));

// 설정 저장소만 가짜다. `@/hooks/useSystemSettings` → `useChartAnimation` → 컴포넌트로
// 이어지는 경로는 실제 코드가 그대로 돈다.
const mockDisplaySettings = jest.fn<Record<string, unknown>, []>();

jest.mock('@/contexts/SystemSettingsContext', () => ({
  useSystemSettings: () => ({
    settings: { display: mockDisplaySettings() },
    isLoading: false,
    error: null,
    getSetting: <C extends SettingCategory, K extends SettingKey<C>>(category: C, key: K) =>
      category === 'display'
        ? ((mockDisplaySettings() as Record<string, unknown>)[key as string] ?? null)
        : null,
  }),
}));

import { OEEGauge } from '../OEEGauge';
import { OEETrendChart } from '../OEETrendChart';
import { DowntimeChart } from '../DowntimeChart';
import { ProductionChart } from '../ProductionChart';
import { IndependentOEETrendChart } from '../IndependentOEETrendChart';
import { MachineComparisonChart as OEEMachineComparisonChart } from '../MachineComparisonChart';
import { QualityDefectTypeChart } from '../QualityDefectTypeChart';
import { QualityTrendChart } from '../QualityTrendChart';
import DefectRateTrendChart from '@/components/quality/DefectRateTrendChart';
import DefectTypeAnalysisChart from '@/components/quality/DefectTypeAnalysisChart';
import QualityMachineComparisonChart from '@/components/quality/MachineComparisonChart';
import { QualityPerformanceChart } from '@/components/quality/QualityPerformanceChart';

// ── 표본 데이터 ────────────────────────────────────────────────────────────
const METRICS: OEEMetrics = {
  availability: 0.9,
  performance: 0.95,
  quality: 0.99,
  oee: 0.846,
  actual_runtime: 594,
  planned_runtime: 660,
  ideal_runtime: 564,
  output_qty: 1000,
  defect_qty: 10,
};

const PRODUCTION: ProductionData[] = [
  { date: '2026-08-01', output_qty: 1000, defect_qty: 10, good_qty: 990, defect_rate: 0.01, shift: 'A' },
  { date: '2026-08-02', output_qty: 900, defect_qty: 18, good_qty: 882, defect_rate: 0.02, shift: 'B' },
];

const DOWNTIME: DowntimeData[] = [
  { state: 'BREAKDOWN_REPAIR', duration: 45, count: 3, percentage: 60 },
  { state: 'TOOL_CHANGE', duration: 30, count: 5, percentage: 40 },
];

/**
 * Chart.js 계열과 Recharts 계열 **양쪽 모두**를 한 번에 그린다.
 * 한 계열만 확인하면 다른 계열의 스위치가 빠져도 통과한다 — 실제로 두 라이브러리는
 * 애니메이션을 끄는 방법이 전혀 다르다.
 */
const renderAllCharts = () => {
  render(
    <>
      {/* Chart.js */}
      <OEEGauge metrics={METRICS} showDetails={false} />
      <OEETrendChart data={CHART_ROWS} showControls={false} />
      <DowntimeChart data={DOWNTIME} showTable={false} />
      <ProductionChart data={PRODUCTION} showControls={false} />
      <ProductionChart data={PRODUCTION} showControls={false} chartType="line" />
      <IndependentOEETrendChart />
      <QualityPerformanceChart data={PRODUCTION} />

      {/* Recharts */}
      <OEEMachineComparisonChart data={COMPARISON} chartType="bar" />
      <OEEMachineComparisonChart data={COMPARISON} chartType="line" />
      <QualityDefectTypeChart data={DEFECT_TYPES} showTable={false} />
      <QualityTrendChart data={QUALITY_TREND} />
      <DefectRateTrendChart data={PRODUCTION} />
      <DefectTypeAnalysisChart data={DEFECT_ANALYSIS} />
      <QualityMachineComparisonChart data={MACHINE_ROWS} chartType="bar" />
      <QualityMachineComparisonChart data={MACHINE_ROWS} chartType="line" />
    </>
  );
};

const COMPARISON = [
  {
    machine_name: 'CNC-001',
    location: 'A동',
    oee: 84.6,
    availability: 90,
    performance: 95,
    quality: 99,
    output_qty: 1000,
    defect_qty: 10,
  },
];

const DEFECT_TYPES = [
  { type: '치수불량', count: 6, percentage: 60 },
  { type: '표면불량', count: 4, percentage: 40 },
];

const QUALITY_TREND = [
  { date: '2026-08-01', defect_rate: 1.0, total_output: 1000, defect_qty: 10 },
  { date: '2026-08-02', defect_rate: 2.0, total_output: 900, defect_qty: 18 },
];

const DEFECT_ANALYSIS = [
  {
    date: '2026-08-01',
    output_qty: 1000,
    defect_qty: 10,
    good_qty: 990,
    defect_rate: 0.01,
    target_qty: 1100,
    shift: 'A' as const,
  },
];

const MACHINE_ROWS = [
  {
    key: 'CNC-001',
    machine: 'CNC-001',
    location: 'A동',
    avgOEE: 84.6,
    availability: 90,
    performance: 95,
    quality: 99,
    downtimeHours: 1.1,
    defectRate: 1.0,
    trend: 'up' as const,
    trendValue: 1.2,
  },
];

/**
 * 렌더링된 차트 수를 못박는다.
 *
 * "전부 false 였다"는 주장은 **아무것도 그려지지 않았을 때도 참**이다. 표본 데이터가
 * 어긋나 컴포넌트가 빈 상태(Empty/로딩)로 빠지면 for 루프가 0회 돌고 검사는 조용히
 * 통과한다 — 이 저장소가 반복해서 당한 실패 방식이다. 숫자를 고정해 두면 차트가 빠지는
 * 순간 검사가 깨진다.
 */
const EXPECTED_CHARTJS = 7;
const EXPECTED_RECHARTS_SERIES = 20;

describe('display.chart_animation_enabled 가 차트에 도달한다', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChartJsOptions.length = 0;
    mockRechartsSeries.length = 0;
  });

  it('설정을 끄면 모든 Chart.js 차트가 animation:false 로 그려진다', () => {
    mockDisplaySettings.mockReturnValue({ chart_animation_enabled: false });
    renderAllCharts();

    expect(mockChartJsOptions).toHaveLength(EXPECTED_CHARTJS);
    for (const options of mockChartJsOptions) {
      expect(options.animation).toBe(false);
    }
  });

  it('설정을 끄면 모든 Recharts 시리즈가 isAnimationActive:false 로 그려진다', () => {
    mockDisplaySettings.mockReturnValue({ chart_animation_enabled: false });
    renderAllCharts();

    expect(mockRechartsSeries).toHaveLength(EXPECTED_RECHARTS_SERIES);
    for (const { type, props } of mockRechartsSeries) {
      expect({ type, isAnimationActive: props.isAnimationActive })
        .toEqual({ type, isAnimationActive: false });
    }
  });

  it('설정을 켜면 애니메이션이 라이브러리 기본값으로 돌아온다', () => {
    mockDisplaySettings.mockReturnValue({ chart_animation_enabled: true });
    renderAllCharts();

    expect(mockChartJsOptions).toHaveLength(EXPECTED_CHARTJS);
    for (const options of mockChartJsOptions) {
      // Chart.js 에서 "켜짐"은 옵션 미지정이다. `false` 가 남아 있으면 설정을 되돌려도
      // 애니메이션이 살아나지 않는다.
      expect(options.animation).toBeUndefined();
    }
    expect(mockRechartsSeries).toHaveLength(EXPECTED_RECHARTS_SERIES);
    for (const { type, props } of mockRechartsSeries) {
      expect({ type, isAnimationActive: props.isAnimationActive })
        .toEqual({ type, isAnimationActive: true });
    }
  });

  it('설정이 아직 도착하지 않았으면 애니메이션을 끄지 않는다', () => {
    // 로딩 몇 프레임 동안 껐다 켜면 차트가 눈에 띄게 튄다. 기본값은 "켜짐"이다.
    mockDisplaySettings.mockReturnValue({});
    renderAllCharts();

    expect(mockChartJsOptions).toHaveLength(EXPECTED_CHARTJS);
    expect(mockRechartsSeries).toHaveLength(EXPECTED_RECHARTS_SERIES);
    for (const options of mockChartJsOptions) {
      expect(options.animation).toBeUndefined();
    }
    for (const { props } of mockRechartsSeries) {
      expect(props.isAnimationActive).toBe(true);
    }
  });
});
