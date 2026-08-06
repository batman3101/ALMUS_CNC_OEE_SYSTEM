import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SettingCategory, SettingKey } from '@/types/systemSettings';
import { OEE_GRADE_COLORS } from '@/lib/oeeGrading';

/**
 * **같은 OEE 는 어느 화면에서 보든 같은 등급이어야 한다.**
 *
 * 이 저장소의 실제 결함이 그것이었다 — 게이지·운영자·관리자는 0.85/0.65, 엔지니어는
 * 0.85 / 0.75 / 0.65 를 각자 적어 두어서 0.80 이 화면에 따라 '양호'와 '보통'으로 갈렸다.
 * 그리고 관리자가 설정 화면에서 목표·임계값을 저장해도 **네 화면 모두 무시했다.**
 *
 * ■ 왜 한 화면만 보는 검사로는 부족한가
 *   결함은 "한 화면이 틀렸다"가 아니라 "화면끼리 다르다"였다. 화면 하나를 고정하는 검사는
 *   고치기 전에도 통과한다. 그래서 네 화면을 **한 테스트 안에서 함께 그려** 색을 비교한다.
 *
 * ■ 왜 소스 문자열이 아니라 렌더링인가
 *   `chartAnimationSetting.test.tsx` 머리말과 같은 이유다. import 줄에 이름만 남기고
 *   실제 배선을 지워도 grep 검사는 통과한다. 여기서는 DOM 에 실제로 칠해진 색을 읽는다.
 *
 * ■ 왜 설정값을 일부러 어긋나게 두는가
 *   목표 0.90 / 저조 0.70 / 심각 0.50 은 **옛 하드코딩(0.85/0.75/0.65) 중 어느 것과도
 *   겹치지 않는다.** 이 설정에서 OEE 0.80 은 '양호(파랑)'인데, 옛 사다리로는 전부
 *   '주황'이다. 어느 화면이든 하드코딩으로 되돌리면 그 화면만 주황이 되어 검사가 깨진다.
 */

// ── 시나리오 값 ────────────────────────────────────────────────────────────
const SETTINGS_TARGET = 0.9;
const SETTINGS_LOW = 0.7;
const SETTINGS_CRITICAL = 0.5;

const OEE_UNDER_TEST = 0.8;          // 설정 기준 'good'
const OEE_TEXT = '80.0%';
const OEE_VALUE_TEXT = '80.0';       // antd Statistic 은 값과 접미사가 나뉜다

const EXPECTED_COLOR = OEE_GRADE_COLORS.good;   // #1890ff
const LEGACY_HARDCODED_COLOR = '#faad14';       // 옛 사다리라면 나왔을 색

const MACHINE = {
  id: 'm1',
  name: 'CNC-001',
  location: 'A동',
  current_state: 'NORMAL_OPERATION',
  is_active: true,
};

const OEE_METRICS = {
  availability: 0.9,
  performance: 0.95,
  quality: 0.99,
  oee: OEE_UNDER_TEST,
  actual_runtime: 600,
  planned_runtime: 660,
  ideal_runtime: 580,
  output_qty: 100,
  defect_qty: 1,
};

// ── 시스템 설정 (네 화면이 공유하는 단 하나의 저장소) ──────────────────────
const oeeSettings: Record<string, number> = {
  target_oee: SETTINGS_TARGET,
  low_oee_threshold: SETTINGS_LOW,
  critical_oee_threshold: SETTINGS_CRITICAL,
};

jest.mock('@/contexts/SystemSettingsContext', () => ({
  useSystemSettings: () => ({
    settings: {},
    isLoading: false,
    error: null,
    getSetting: <C extends SettingCategory, K extends SettingKey<C>>(category: C, key: K) =>
      category === 'oee' ? (oeeSettings[key as string] ?? null) : null,
    getSettingsByCategory: () => ({}),
  }),
}));

// ── 번역 ───────────────────────────────────────────────────────────────────
const translation = {
  t: (key: string, vars?: Record<string, unknown>) =>
    vars && typeof vars.defaultValue === 'string' ? key : key,
  language: 'ko',
  i18n: { language: 'ko', changeLanguage: jest.fn() },
};

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => translation,
  useDashboardTranslation: () => translation,
  useMachinesTranslation: () => translation,
  useCommonTranslation: () => translation,
}));

jest.mock('@/hooks/useClientOnly', () => ({ useClientOnly: () => true }));
jest.mock('@/hooks/useAutoRefresh', () => ({ useAutoRefresh: () => undefined }));
jest.mock('@/hooks/useChartAnimation', () => ({
  useChartAnimation: () => ({ enabled: true, chartJs: undefined, recharts: true }),
}));
jest.mock('react-chartjs-2', () => ({ Doughnut: () => null, Line: () => null, Bar: () => null }));

// ── 화면별 데이터 계층 ─────────────────────────────────────────────────────
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'operator', assigned_machines: ['m1'] } }),
}));

jest.mock('@/hooks/useRealtimeData', () => ({
  useRealtimeData: () => ({
    machines: [MACHINE],
    machineLogs: [],
    productionRecords: [],
    oeeMetrics: { m1: OEE_METRICS },
    loading: false,
    error: null,
    refresh: jest.fn(),
    isConnected: true,
  }),
}));

jest.mock('@/components/dashboard/operator-console/MachineConsole', () => ({
  MachineConsole: () => null,
}));

jest.mock('@/hooks/useEngineerData', () => ({
  useEngineerData: () => ({
    oeeData: [],
    downtimeData: [],
    productionData: [],
    machineDowntime: {},
    overallPerformance: {
      avg_availability: 0.9,
      avg_performance: 0.95,
      avg_quality: 0.99,
      avg_oee: OEE_UNDER_TEST,
      total_actual_runtime: 600,
      total_planned_runtime: 660,
      total_ideal_runtime: 580,
      total_output_qty: 100,
      total_defect_qty: 1,
    },
    reportingCoverage: null,
    loading: false,
    error: null,
    refreshData: jest.fn(),
  }),
}));

// 설비별 집계의 OEE 만 시험마다 바꾼다 (등급 필터 검사에서 다른 칸을 겨냥한다).
let machineStatOEE = OEE_UNDER_TEST;

jest.mock('@/hooks/useMachineOEEStats', () => ({
  useMachineOEEStats: () => ({
    stats: {
      m1: {
        machine_id: 'm1',
        total_records: 1,
        reported_records: 1,
        avg_oee: machineStatOEE,
        avg_availability: 0.9,
        avg_performance: 0.95,
        avg_quality: 0.99,
        total_output: 100,
        total_defect: 1,
      },
    },
    loading: false,
  }),
}));

// 차트는 이 검사의 대상이 아니다. 등급 색이 붙는 자리(표·통계 카드)만 실제로 그린다.
jest.mock('@/components/oee', () => ({
  OEEGauge: () => null,
  OEETrendChart: () => null,
  IndependentOEETrendChart: () => null,
  DowntimeChart: () => null,
  ProductionChart: () => null,
}));
jest.mock('@/components/quality', () => ({
  DefectRateTrendChart: () => null,
  QualityPerformanceChart: () => null,
  MachineComparisonChart: () => null,
}));
jest.mock('@/components/notifications', () => ({ DashboardAlerts: () => null }));
jest.mock('@/components/common/DateRangeSelector', () => ({ DateRangeSelector: () => null }));

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/hooks/useFailureReport', () => ({ useFailureReport: () => jest.fn() }));
jest.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => ({
    notifications: [],
    acknowledgeNotification: jest.fn(),
    clearAllNotifications: jest.fn(),
  }),
}));
jest.mock('@/contexts/DateRangeContext', () => ({
  useDateRange: () => ({
    dateRange: null,
    preset: 'week',
    getFormattedRange: () => ({ startDate: '2026-08-01', endDate: '2026-08-06' }),
  }),
}));
jest.mock('@/hooks/useOperationalAlerts', () => ({
  useOperationalAlerts: () => ({
    alerts: [],
    error: null,
    alertStats: { unacknowledged: 0, critical: 0 },
    acknowledgeAlert: jest.fn(),
    clearAllAlerts: jest.fn(),
    requestNotificationPermission: jest.fn(),
    refreshAlerts: jest.fn(),
  }),
}));
jest.mock('@/hooks/useRealtimeProductionRecords', () => ({
  useRealtimeProductionRecords: () => ({
    records: [],
    loading: false,
    error: null,
    aggregatedData: () => ({
      recordCount: 1,
      unreportedCount: 0,
      impossibleCount: 0,
      avgOEEExcludingImpossible: OEE_UNDER_TEST * 100,
      avgQualityExcludingImpossible: 99,
      avgAvailability: 90,
      avgPerformance: 95,
      avgQuality: 99,
      avgOEE: OEE_UNDER_TEST * 100,
      totalActualRuntime: 600,
      totalPlannedRuntime: 660,
      totalIdealRuntime: 580,
      totalProduction: 100,
      totalDefects: 1,
    }),
    aggregateSnapshot: { scopeKey: '2026-08-01|2026-08-06||' },
    refreshRecords: jest.fn(),
  }),
}));
jest.mock('@/lib/machinesCache', () => ({ fetchMachines: jest.fn(async () => [MACHINE]) }));
jest.mock('@/lib/authFetch', () => ({
  authFetch: jest.fn(async (url: string) => {
    if (url.startsWith('/api/productivity-analysis')) {
      return {
        ok: true,
        json: async () => ({
          machine_analysis: [{
            machine_id: 'm1',
            machine_name: 'CNC-001',
            oee_available: true,
            avg_oee: OEE_UNDER_TEST,
            avg_availability: 0.9,
            avg_performance: 0.95,
            avg_quality: 0.99,
            total_output: 100,
            total_defect_qty: 1,
            total_planned_runtime: 660,
            total_actual_runtime: 600,
            total_ideal_runtime: 580,
          }],
          trends: { daily: [] },
        }),
      };
    }
    if (url.startsWith('/api/machine-status-descriptions')) {
      return { ok: true, json: async () => ({ success: true, data: [] }) };
    }
    return { ok: true, json: async () => [] };
  }),
}));

import { OEEGauge } from '../oee/OEEGauge';
import { OperatorDashboard } from '../dashboard/OperatorDashboard';
import { EngineerDashboard } from '../dashboard/EngineerDashboard';
import { AdminDashboard } from '../dashboard/AdminDashboard';

// ── 색 추출 ────────────────────────────────────────────────────────────────
/** `#1890ff` → `rgb(24, 144, 255)` (jsdom 이 인라인 스타일을 이 형태로 정규화한다) */
const toRgb = (hex: string): string => {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};

/** antd Statistic 의 값 영역에 칠해진 색 (제목으로 카드를 특정한다) */
const statisticColor = (container: HTMLElement, title: string): string => {
  const card = Array.from(container.querySelectorAll<HTMLElement>('.ant-statistic')).find(
    node => node.querySelector('.ant-statistic-title')?.textContent === title
  );
  if (!card) throw new Error(`Statistic not found: ${title}`);
  const content = card.querySelector<HTMLElement>('.ant-statistic-content');
  if (!content) throw new Error(`Statistic content not found: ${title}`);
  expect(content.textContent).toContain(OEE_VALUE_TEXT);
  return content.style.color;
};

describe('OEE 등급은 네 화면에서 같다', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    machineStatOEE = OEE_UNDER_TEST;
  });

  it('게이지: 설정된 사다리를 따른다', () => {
    render(<OEEGauge metrics={OEE_METRICS} showDetails={false} />);

    expect(screen.getByText(OEE_TEXT)).toHaveStyle({ color: EXPECTED_COLOR });
  });

  it('운영자 화면: 설정된 사다리를 따른다', () => {
    render(<OperatorDashboard />);

    expect(screen.getByText(OEE_TEXT)).toHaveStyle({ color: EXPECTED_COLOR });
  });

  it('엔지니어 화면: 설정된 사다리를 따른다', () => {
    const { container } = render(<EngineerDashboard />);

    expect(statisticColor(container, 'dashboard:engineerDashboard.averageOee'))
      .toBe(toRgb(EXPECTED_COLOR));
  });

  it('관리자 화면: 설정된 사다리를 따른다', async () => {
    const { container } = render(<AdminDashboard />);

    await waitFor(() => {
      expect(statisticColor(container, 'statistics.overallOee')).toBe(toRgb(EXPECTED_COLOR));
    });
  });

  /**
   * 결함 자체를 겨냥한 검사. 위 네 개가 각각 통과해도 이 검사가 없으면 "네 화면이 서로
   * 같다"는 주장은 검증되지 않는다 — 각 화면이 우연히 같은 기대값을 갖고 있을 뿐이다.
   */
  it('네 화면이 같은 OEE 에 같은 색을 칠한다', async () => {
    const gauge = render(<OEEGauge metrics={OEE_METRICS} showDetails={false} />);
    const gaugeColor = gauge.getByText(OEE_TEXT).style.color;
    gauge.unmount();

    const operator = render(<OperatorDashboard />);
    const operatorColor = operator.getByText(OEE_TEXT).style.color;
    operator.unmount();

    const engineer = render(<EngineerDashboard />);
    const engineerColor = statisticColor(
      engineer.container, 'dashboard:engineerDashboard.averageOee');
    engineer.unmount();

    const admin = render(<AdminDashboard />);
    await waitFor(() => {
      expect(statisticColor(admin.container, 'statistics.overallOee')).not.toBe('');
    });
    const adminColor = statisticColor(admin.container, 'statistics.overallOee');
    admin.unmount();

    expect({ gaugeColor, operatorColor, engineerColor, adminColor }).toEqual({
      gaugeColor: toRgb(EXPECTED_COLOR),
      operatorColor: toRgb(EXPECTED_COLOR),
      engineerColor: toRgb(EXPECTED_COLOR),
      adminColor: toRgb(EXPECTED_COLOR),
    });

    // 옛 하드코딩 사다리로 되돌아가면 이 값은 주황이 된다.
    expect(gaugeColor).not.toBe(toRgb(LEGACY_HARDCODED_COLOR));
  });

  /**
   * 엔지니어 화면의 **등급 필터**는 색이 아니라 분류를 사용자에게 노출한다. 여기에만
   * 0.75 라는 네 번째 경계가 있었고 — 어떤 설정도 표현하지 않는 숫자였다 — 그래서 같은
   * 설비가 이 화면에서만 다른 칸에 들어갔다.
   *
   * OEE 0.72 가 판별자다: 설정(저조 0.70) 기준으로는 '양호' 칸이지만, 옛 사다리(0.75)
   * 기준으로는 '보통' 칸이다. 두 칸의 개수를 함께 보므로 어느 쪽으로 되돌려도 깨진다.
   */
  it('엔지니어 등급 필터도 같은 사다리로 설비를 센다', async () => {
    machineStatOEE = 0.72;

    render(<EngineerDashboard />);
    fireEvent.click(screen.getByRole('button', { name: /dashboard:buttons\.filter/ }));

    expect(await screen.findByText('dashboard:oeeGrades.good (1)')).toBeInTheDocument();
    expect(screen.getByText('dashboard:oeeGrades.fair (0)')).toBeInTheDocument();
  });
});
