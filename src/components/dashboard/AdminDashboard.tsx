'use client';

import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Statistic, Table, Progress, Alert, Space, Button, Spin, message, Badge, Drawer, List, Empty, Typography, Tag, Tooltip, Modal } from 'antd';
import { 
  DashboardOutlined, 
  DesktopOutlined, 
  WarningOutlined,
  RiseOutlined,
  ReloadOutlined,
  WifiOutlined,
  BellOutlined
} from '@ant-design/icons';
import { OEEGauge, OEETrendChart } from '@/components/oee';
import { DashboardAlerts } from '@/components/notifications';
import { OEEMetrics, Machine } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';
import { useNotifications } from '@/contexts/NotificationContext';
import { useDashboardTranslation } from '@/hooks/useTranslation';
import { useRealtimeProductionRecords } from '@/hooks/useRealtimeProductionRecords';
import { useOperationalAlerts } from '@/hooks/useOperationalAlerts';
import { DateRangeSelector } from '@/components/common/DateRangeSelector';
import { useDateRange } from '@/contexts/DateRangeContext';
import { fetchMachines } from '@/lib/machinesCache';
import { formatMachineLocation } from '@/utils/machineLocation';
import { authFetch } from '@/lib/authFetch';

// 대시보드가 지원하는 최대 기간(최근 30일 프리셋)을 커버하는 행수 상한.
// 설비 800대 × 2교대 × 30일 ≈ 48,000행이므로 50,000행이면 프리셋 전 구간이 잘리지 않는다.
const ADMIN_RECORD_LIMIT = 50000;

interface AdminDashboardProps {
  onError?: (error: Error) => void;
}

interface AdminOeeAnalytics {
  machine_analysis: Array<{
    machine_id: string;
    machine_name: string;
    oee_available: boolean;
    avg_oee: number | null;
    avg_availability: number | null;
    avg_performance: number | null;
    avg_quality: number | null;
    total_output: number;
    total_defect_qty: number;
    total_planned_runtime: number;
    total_actual_runtime: number;
    total_ideal_runtime: number;
  }>;
  trends: {
    daily: Array<{
      date: string;
      avg_oee: number | null;
      avg_availability: number | null;
      avg_performance: number | null;
      avg_quality: number | null;
    }>;
  };
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onError }) => {
  const { t, i18n } = useDashboardTranslation();
  const isClient = useClientOnly();
  const {
    notifications,
    acknowledgeNotification,
    clearAllNotifications,
  } = useNotifications();
  const { dateRange, getFormattedRange, preset } = useDateRange();
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [adminOeeAnalytics, setAdminOeeAnalytics] = useState<AdminOeeAnalytics | null>(null);
  const [dashboardData, setDashboardData] = useState<{
    machines: Machine[];
    models: unknown[];
  } | null>(null);
  const [statusDescriptions, setStatusDescriptions] = useState<Array<{
    status: string;
    description_ko: string;
    description_vi: string;
  }>>([]);

  // 선택된 기간 (생산 기록 조회의 단일 기준)
  const formattedRange = getFormattedRange();

  // 실시간 생산 기록 데이터 구독
  // ✅ 생산 기록의 단일 소스: 선택된 기간 + 행수 상한을 명시적으로 전달한다
  //    (별도의 /api/production-records 호출은 제거됨)
  const {
    records: productionRecords,
    loading: recordsLoading,
    error: recordsError,
    aggregatedData,
    aggregateSnapshot,
    refreshRecords
  } = useRealtimeProductionRecords({
    filters: {
      dateRange: {
        start: formattedRange.startDate,
        end: formattedRange.endDate
      }
    },
    limit: ADMIN_RECORD_LIMIT
  });

  const currentAggregateScope = `${formattedRange.startDate}|${formattedRange.endDate}||`;

  // Headline summary와 동일한 DB 시점이 확정된 뒤 설비별/일별 집계를 조회한다.
  // Realtime 및 수동 refresh가 summary revision을 올리므로 세 통계가 함께 갱신된다.
  useEffect(() => {
    if (aggregateSnapshot.scopeKey !== currentAggregateScope) {
      setAdminOeeAnalytics(null);
      setAnalyticsLoading(recordsLoading);
      if (!recordsLoading) setAnalyticsError('전체 기간 OEE 통계를 불러오지 못했습니다.');
      return;
    }

    const controller = new AbortController();
    const loadAnalytics = async () => {
      setAnalyticsLoading(true);
      setAnalyticsError(null);
      try {
        const params = new URLSearchParams({
          start_date: formattedRange.startDate,
          end_date: formattedRange.endDate,
          analysis_type: 'summary',
        });
        const response = await authFetch(`/api/productivity-analysis?${params}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as AdminOeeAnalytics;
        setAdminOeeAnalytics(payload);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Admin 전체 기간 OEE 분석 조회 실패:', error);
          setAdminOeeAnalytics(null);
          setAnalyticsError('전체 기간 OEE 분석을 불러오지 못했습니다.');
        }
      } finally {
        if (!controller.signal.aborted) setAnalyticsLoading(false);
      }
    };
    void loadAnalytics();
    return () => controller.abort();
  }, [aggregateSnapshot, currentAggregateScope, formattedRange.startDate, formattedRange.endDate, recordsLoading]);

  const {
    alerts: realtimeAlerts,
    error: operationalAlertsError,
    alertStats,
    acknowledgeAlert,
    clearAllAlerts,
    requestNotificationPermission,
    refreshAlerts: refreshOperationalAlerts,
  } = useOperationalAlerts();

  const generalUnacknowledgedCount = notifications.filter(
    notification => !notification.acknowledged
  ).length;
  const combinedUnacknowledgedCount = generalUnacknowledgedCount + alertStats.unacknowledged;
  const combinedCriticalCount = notifications.filter(
    notification => notification.severity === 'critical'
  ).length + alertStats.critical;
  const clearAllVisibleAlerts = React.useCallback(async () => {
    await Promise.all([clearAllNotifications(), clearAllAlerts()]);
  }, [clearAllAlerts, clearAllNotifications]);

  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [showMachineStatusModal, setShowMachineStatusModal] = useState(false);
  const [selectedStatusType, setSelectedStatusType] = useState<'maintenance' | 'stopped' | null>(null);
  // ✅ 기본 필터를 'unacknowledged'로 변경 (확인된 알림 숨김)
  const [notificationFilter, setNotificationFilter] = useState<'all' | 'critical' | 'unacknowledged'>('unacknowledged');

  const { Text } = Typography;

  // 상태 텍스트 변환 함수 (DB의 상태 설명 데이터 사용)
  const getStatusText = (state?: string) => {
    if (!state || statusDescriptions.length === 0) {
      // 상태 설명 데이터가 없으면 기본 번역 사용.
      // 설비 상태 라벨은 machines:states.* 에 있다 (dashboard:status.* 는 폴링/실시간 연결 상태라
      // 전혀 다른 키다. 예전에는 그쪽을 가리키고 있어서 이 폴백 경로가 raw 키를 그대로 노출했다).
      const label = t(`machines:states.${state}`, { defaultValue: '' });
      return label || t('machines:states.unknown');
    }

    // DB에서 가져온 상태 설명 데이터 사용
    const statusDesc = statusDescriptions.find(desc => desc.status === state);
    if (statusDesc) {
      const language = i18n.language as 'ko' | 'vi';
      return language === 'vi' ? statusDesc.description_vi : statusDesc.description_ko;
    }

    // 디버그 로그 (개발 모드에서만)
    if (process.env.NODE_ENV === 'development') {
      console.warn(`Missing status description for machine state: ${state}`);
    }

    return t('machines:states.unknown');
  };

  // 실시간 OEE 메트릭 계산
  // 주의: aggregatedData는 useCallback으로 반환되는 "함수"이므로 항상 truthy함 - 반드시 호출해서 결과를 확인해야 함
  const calculateRealTimeOEEMetrics = (): OEEMetrics | null => {
    const aggregated = aggregatedData();

    if (
      !aggregated ||
      aggregated.recordCount === 0 ||
      aggregated.avgAvailability === null ||
      aggregated.avgPerformance === null ||
      aggregated.avgQuality === null ||
      aggregated.avgOEE === null
    ) {
      return null;
    }

    return {
      availability: aggregated.avgAvailability / 100,
      performance: aggregated.avgPerformance / 100,
      quality: aggregated.avgQuality / 100,
      oee: aggregated.avgOEE / 100,
      actual_runtime: aggregated.totalActualRuntime,
      planned_runtime: aggregated.totalPlannedRuntime,
      ideal_runtime: aggregated.totalIdealRuntime,
      output_qty: aggregated.totalProduction,
      defect_qty: aggregated.totalDefects
    };
  };

  // 실제 데이터 가져오기 (생산 기록은 실시간 훅이 담당하므로 여기서 조회하지 않는다)
  const fetchDashboardData = async (options?: { force?: boolean }) => {
    try {
      setDashboardLoading(true);

      // 병렬로 모든 데이터 가져오기
      // 설비 목록은 NotificationContext와 공유되는 캐시를 통해 조회한다 (중복 호출 제거)
      const [machinesData, modelsRes, statusDescRes] = await Promise.all([
        fetchMachines({ force: options?.force }).catch((error: unknown) => {
          console.error('Machines API failed:', error);
          return [] as Machine[];
        }),
        authFetch('/api/product-models', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        }),
        authFetch('/api/machine-status-descriptions', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        })
      ]);

      let modelsData = [];
      let statusDescriptions = [];

      console.log('Machines data loaded:', machinesData.length);

      if (modelsRes.ok) {
        try {
          const data = await modelsRes.json();
          modelsData = Array.isArray(data) ? data : [];
          console.log('Models data loaded:', modelsData.length);
        } catch (error) {
          console.error('Error parsing models response:', error);
          modelsData = [];
        }
      } else {
        console.error('Models API failed:', modelsRes.status);
        modelsData = [];
      }

      if (statusDescRes.ok) {
        try {
          const response = await statusDescRes.json();
          statusDescriptions = response.success ? (response.data || []) : [];
          console.log('Status descriptions loaded:', statusDescriptions.length);
        } catch (error) {
          console.error('Error parsing status descriptions response:', error);
          statusDescriptions = [];
        }
      } else {
        console.error('Status descriptions API failed:', statusDescRes.status);
        statusDescriptions = [];
      }

      // 데이터가 하나도 없으면 에러 처리, 그렇지 않으면 저장
      if (machinesData.length === 0) {
        throw new Error('설비 데이터를 불러올 수 없습니다. API 응답을 확인해주세요.');
      }

      setDashboardData({
        machines: machinesData,
        models: modelsData
      });

      // 상태 설명 데이터 저장
      setStatusDescriptions(statusDescriptions);

      // 데이터 저장 확인 로깅
      console.log('✅ DashboardData 저장 완료:', {
        machinesCount: machinesData.length,
        sampleMachines: machinesData.slice(0, 3).map((m: Machine) => ({ name: m.name, state: m.current_state })),
        normalCount: machinesData.filter((m: Machine) => m.current_state === 'NORMAL_OPERATION').length
      });

      if (process.env.NODE_ENV === 'development') {
        console.log('Dashboard data fetched successfully:', {
          machines: machinesData.length,
          models: modelsData.length
        });

        // 설비 상태별 카운트 로깅
        const statusCounts = {
          normal: machinesData.filter((m: Machine) => m.current_state === 'NORMAL_OPERATION').length,
          maintenance: machinesData.filter((m: Machine) => ['MAINTENANCE', 'PM_MAINTENANCE', 'INSPECTION'].includes(m.current_state || '')).length,
          stopped: machinesData.filter((m: Machine) => ['TEMPORARY_STOP', 'PLANNED_STOP', 'BREAKDOWN_REPAIR'].includes(m.current_state || '')).length
        };
        console.log('Machine status counts from DB:', statusCounts);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      message.error('대시보드 데이터를 불러오는데 실패했습니다');
      if (onError) {
        onError(error as Error);
      }
    } finally {
      setDashboardLoading(false);
    }
  };

  // 컴포넌트 마운트 시 데이터 가져오기
  useEffect(() => {
    if (isClient) {
      fetchDashboardData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, dateRange]);

  // 대시보드 데이터 상태 변경 감지
  useEffect(() => {
    console.log('🔄 dashboardData 상태 변경 감지:', {
      hasDashboardData: dashboardData ? 'exists' : 'null',
      machinesCount: dashboardData?.machines?.length || 0,
      timestamp: new Date().toLocaleTimeString()
    });
  }, [dashboardData]);

  // 에러 핸들링 (mockRealtimeData는 에러가 없으므로 제거)

  // 설비별 OEE도 전체 기간 DB 집계를 사용한다. 원본 페이지는 상세 표시에만 사용한다.
  const machineOeeData = React.useMemo(() => {
    const oeeMetrics: Record<string, OEEMetrics> = {};
    // 생산 기록이 실제로 존재하는 설비 목록 (전체 OEE 평균 계산 시 데이터 없는 설비 제외용)
    const machinesWithData: string[] = [];
    const machines = dashboardData?.machines ?? [];

    const analyticsByMachine = new Map(
      (adminOeeAnalytics?.machine_analysis ?? []).map(row => [row.machine_id, row])
    );

    machines.forEach((machine: Machine) => {
      const machineAggregate = analyticsByMachine.get(machine.id);

      if (
        !machineAggregate ||
        !machineAggregate.oee_available ||
        machineAggregate.avg_availability === null ||
        machineAggregate.avg_performance === null ||
        machineAggregate.avg_quality === null ||
        machineAggregate.avg_oee === null
      ) {
        return;
      }

      machinesWithData.push(machine.id);

      oeeMetrics[machine.id] = {
        availability: machineAggregate.avg_availability,
        performance: machineAggregate.avg_performance,
        quality: machineAggregate.avg_quality,
        oee: machineAggregate.avg_oee,
        actual_runtime: machineAggregate.total_actual_runtime,
        planned_runtime: machineAggregate.total_planned_runtime,
        ideal_runtime: machineAggregate.total_ideal_runtime,
        output_qty: machineAggregate.total_output,
        defect_qty: machineAggregate.total_defect_qty
      };
    });

    return { oeeMetrics, machinesWithData };
  }, [dashboardData, adminOeeAnalytics]);

  // 데이터 처리 및 계산
  const processedData = React.useMemo(() => {
    try {
      console.log('Processing dashboard data:', {
        dashboardData: dashboardData ? 'exists' : 'null',
        machinesCount: dashboardData?.machines?.length || 0,
        productionRecordsCount: productionRecords.length,
        aggregatedData: aggregatedData() ? 'exists' : 'null',
        recordsLoading,
        recordsError,
        selectedPreset: preset,
        dashboardLoading
      });
      
      // 실제 설비 데이터 로깅
      if (dashboardData && dashboardData.machines.length > 0) {
        console.log('실제 설비 데이터 상태별 카운트:', {
          total: dashboardData.machines.length,
          normal: dashboardData.machines.filter((m: Machine) => m.current_state === 'NORMAL_OPERATION').length,
          maintenance: dashboardData.machines.filter((m: Machine) => ['MAINTENANCE', 'PM_MAINTENANCE', 'INSPECTION'].includes(m.current_state || '')).length,
          stopped: dashboardData.machines.filter((m: Machine) => ['TEMPORARY_STOP', 'PLANNED_STOP', 'BREAKDOWN_REPAIR'].includes(m.current_state || '')).length,
          other: dashboardData.machines.filter((m: Machine) => !['NORMAL_OPERATION', 'MAINTENANCE', 'PM_MAINTENANCE', 'INSPECTION', 'TEMPORARY_STOP', 'PLANNED_STOP', 'BREAKDOWN_REPAIR'].includes(m.current_state || '')).length
        });
        console.log('첫 10개 설비 상태:', dashboardData.machines.slice(0, 10).map((m: Machine) => ({ name: m.name, state: m.current_state })));
      }

      // 대시보드 데이터가 있으면 우선 사용 (강제 조건 확인)
      if (dashboardData && dashboardData.machines && Array.isArray(dashboardData.machines) && dashboardData.machines.length > 0 && adminOeeAnalytics && aggregateSnapshot.scopeKey === currentAggregateScope) {
        console.log('✅ 실제 데이터베이스 데이터 처리 시작 - 설비 수:', dashboardData.machines.length);
        const { machines: dbMachines } = dashboardData;
        const { oeeMetrics: dbOeeMetrics, machinesWithData: dbMachinesWithData } = machineOeeData;

        // 전체 카드는 원본 행 페이지가 아니라 DB 전체 범위 집계를 사용한다.
        // 3개월 이상에서는 원본 행이 50,000건을 넘으므로 클라이언트 설비 평균을 다시
        // 평균하면 최신 일부 데이터만 전체처럼 보이게 된다.
        const overallMetrics = calculateRealTimeOEEMetrics();
        
        // 설비 목록에 OEE 정보 추가
        const machineList = dbMachines.map((machine: Machine) => ({
          ...machine,
          oee: dbOeeMetrics[machine.id]?.oee ?? null,
          status: getStatusText(machine.current_state)
        }));
        
        // 알림 생성 (OEE 기반)
        type MachineWithOEE = Machine & { oee: number | null; status: string };
        const alerts = machineList
          .filter((machine: MachineWithOEE) =>
            (dbMachinesWithData.includes(machine.id) && machine.oee !== null && machine.oee < 0.6) ||
            machine.current_state !== 'NORMAL_OPERATION'
          )
          .slice(0, 5)
          .map((machine: MachineWithOEE, index: number) => {
            const isLowOee = dbMachinesWithData.includes(machine.id) && machine.oee !== null && machine.oee < 0.6;
            return {
              id: index + 1,
              machine: machine.name,
              message: isLowOee ? 'OEE 60% 미만 지속' :
                       machine.current_state === 'INSPECTION' ? '점검 중' :
                       machine.current_state === 'TEMPORARY_STOP' ? '일시 정지' :
                       '설비 상태 확인 필요',
              severity: isLowOee && machine.oee !== null && machine.oee < 0.5 ? 'error' as const : 'warning' as const,
              time: t('time.realTime')
            };
          });
        
        const trendData = (adminOeeAnalytics?.trends.daily ?? []).flatMap(item => {
          if (
            item.avg_availability === null ||
            item.avg_performance === null ||
            item.avg_quality === null ||
            item.avg_oee === null
          ) {
            return [];
          }

          return [{
            date: item.date,
            availability: item.avg_availability,
            performance: item.avg_performance,
            quality: item.avg_quality,
            oee: item.avg_oee,
          }];
        });

        console.log('📊 차트용 변환된 데이터 (날짜별 집계):', {
          trendDataLength: trendData.length,
          sampleData: trendData.slice(0, 3),
          dateRange: trendData.length > 0 ? {
            start: trendData[0].date,
            end: trendData[trendData.length - 1].date
          } : 'No data'
        });
        
        return {
          overallMetrics,
          machineList,
          alerts,
          trendData,
          machinesWithDataCount: dbMachinesWithData.length
        };
      }

      // 로딩 중일 때는 빈 데이터 반환 (에러 없이)
      if (recordsLoading || dashboardLoading || analyticsLoading || aggregateSnapshot.scopeKey !== currentAggregateScope) {
        console.log('Data is loading, returning empty data');
        return {
          overallMetrics: null,
          machineList: [],
          alerts: [],
          trendData: [],
          machinesWithDataCount: 0
        };
      }

      // 데이터가 없는 경우 에러 메시지 표시
      console.log('No data available, throwing error');
      throw new Error(analyticsError || '설비 데이터를 불러올 수 없습니다. Supabase 연결을 확인해주세요.');
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error processing admin dashboard data:', error);
      }
      // 에러 시 빈 데이터와 에러 메시지 반환
      const errorMessage = (error as Error).message || '데이터를 불러오는데 실패했습니다';
      message.error(errorMessage);
      
      return {
        overallMetrics: null,
        machineList: [],
        alerts: [{
          id: 1,
          machine: '시스템',
          message: errorMessage,
          severity: 'error' as const,
          time: '지금'
        }],
        trendData: [],
        machinesWithDataCount: 0
      };
    }
  }, [productionRecords, aggregatedData, dashboardData, machineOeeData, adminOeeAnalytics, analyticsLoading, analyticsError, aggregateSnapshot.scopeKey, currentAggregateScope]);

  // 설비 상태별 통계 (실제 데이터베이스 기반)
  const machineStats = React.useMemo(() => {
    // 실제 데이터베이스 데이터가 있을 때는 전체 설비 데이터 사용
    if (dashboardData && dashboardData.machines.length > 0) {
      const allMachines = dashboardData.machines;
      return {
        total: allMachines.length,
        running: allMachines.filter((m: Machine) => m.current_state === 'NORMAL_OPERATION').length,
        maintenance: allMachines.filter((m: Machine) => ['MAINTENANCE', 'PM_MAINTENANCE', 'INSPECTION'].includes(m.current_state || '')).length,
        stopped: allMachines.filter((m: Machine) => ['TEMPORARY_STOP', 'PLANNED_STOP', 'BREAKDOWN_REPAIR'].includes(m.current_state || '')).length,
      };
    }
    
    // 실시간 데이터만 있는 경우 (fallback)
    return {
      total: processedData.machineList.length,
      running: processedData.machineList.filter(m => m.current_state === 'NORMAL_OPERATION').length,
      maintenance: processedData.machineList.filter(m => ['MAINTENANCE', 'PM_MAINTENANCE', 'INSPECTION'].includes(m.current_state || '')).length,
      stopped: processedData.machineList.filter(m => ['TEMPORARY_STOP', 'PLANNED_STOP', 'BREAKDOWN_REPAIR'].includes(m.current_state || '')).length,
    };
  }, [dashboardData, processedData.machineList]);

  // 상태별 설비 목록 생성
  const getDetailedMachineStatus = () => {
    if (!dashboardData?.machines) return { maintenance: [], stopped: [] };
    
    const maintenanceMachines = dashboardData.machines.filter((m: Machine) =>
      ['MAINTENANCE', 'PM_MAINTENANCE', 'INSPECTION'].includes(m.current_state || '')
    );

    const stoppedMachines = dashboardData.machines.filter((m: Machine) =>
      ['TEMPORARY_STOP', 'PLANNED_STOP', 'BREAKDOWN_REPAIR', 'MODEL_CHANGE', 'PROGRAM_CHANGE', 'TOOL_CHANGE'].includes(m.current_state || '')
    );
    
    return { maintenance: maintenanceMachines, stopped: stoppedMachines };
  };

  // 모달 열기 함수
  const showMachineStatusDetail = (type: 'maintenance' | 'stopped') => {
    setSelectedStatusType(type);
    setShowMachineStatusModal(true);
  };

  // 테이블 컬럼 정의
  const machineColumns = [
    {
      title: t('table.machineName'),
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: t('table.location'),
      dataIndex: 'location',
      key: 'location',
      width: 120,
      // DB 에는 'A동'/'B동' 처럼 한국어로 저장돼 있으므로 표시할 때만 번역한다.
      render: (location: string) => formatMachineLocation(location, t),
    },
    {
      title: t('table.status'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string, record: { current_state?: string }) => {
        const translatedStatus = getStatusText(record.current_state);
        const color = record.current_state === 'NORMAL_OPERATION' ? 'success' : 
                     ['MAINTENANCE', 'PM_MAINTENANCE', 'INSPECTION'].includes(record.current_state || '') ? 'warning' : 'error';
        return <span style={{ color: color === 'success' ? '#52c41a' : color === 'warning' ? '#faad14' : '#ff4d4f' }}>{translatedStatus}</span>;
      },
    },
    {
      title: 'OEE',
      dataIndex: 'oee',
      key: 'oee',
      width: 120,
      render: (oee: number | null) => oee === null
        ? <span style={{ color: '#8c8c8c' }}>—</span>
        : (
          <Progress
            percent={oee * 100}
            size="small"
            strokeColor={oee >= 0.85 ? '#52c41a' : oee >= 0.65 ? '#faad14' : '#ff4d4f'}
            format={(percent) => `${percent?.toFixed(1)}%`}
          />
        ),
    },
  ];

  // 로딩 상태 표시 (초기 로딩만, 데이터 업데이트 시에는 스피너 오버레이 사용)
  if (dashboardLoading && !dashboardData && isClient) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '60vh',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <Spin size="large" />
        <div style={{ color: '#666', fontSize: '16px' }}>
          {t('adminDashboard.loadingMachineData')}
        </div>
        <div style={{ color: '#999', fontSize: '14px' }}>
          {t('adminDashboard.loadingMachineCount', { count: 60 })}
        </div>
      </div>
    );
  }

  return (
    <Spin spinning={dashboardLoading || recordsLoading || analyticsLoading || aggregateSnapshot.scopeKey !== currentAggregateScope} tip={t('adminDashboard.updatingMessage')}>
      <div>
      {/* 헤더 */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 'bold' }}>
              <DashboardOutlined style={{ marginRight: 8 }} />
              {t('adminDashboard.title')}
            </h1>
            <p style={{ margin: '4px 0 0 0', color: '#666' }}>
              {t('adminDashboard.description')}
              {productionRecords.length > 0 && (
                <span style={{ marginLeft: 8, color: '#52c41a' }}>
                  <WifiOutlined /> {t('adminDashboard.realtimeActive')} ({t('adminDashboard.recordCount', { count: productionRecords.length })})
                </span>
              )}
              {recordsLoading && (
                <span style={{ marginLeft: 8, color: '#1890ff' }}>
                  <WifiOutlined /> {t('adminDashboard.dataLoading')}
                </span>
              )}
              {recordsError && (
                <span style={{ marginLeft: 8, color: '#ff4d4f' }}>
                  <WifiOutlined /> {t('adminDashboard.connectionError')}: {recordsError}
                </span>
              )}
              {!recordsLoading && productionRecords.length === 0 && !recordsError && (
                <span style={{ marginLeft: 8, color: '#faad14' }}>
                  <WifiOutlined /> {t('adminDashboard.noProductionRecord')}
                </span>
              )}
            </p>
          </div>
        </div>
        <Space>
          <DateRangeSelector />
          <Badge count={alertStats.unacknowledged} size="small">
            <Button
              icon={<BellOutlined />}
              onClick={() => setShowNotificationPanel(true)}
              type={alertStats.critical > 0 ? "primary" : "default"}
              danger={alertStats.critical > 0}
            >
              {t('adminDashboard.notification')} ({alertStats.total})
            </Button>
          </Badge>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              fetchDashboardData({ force: true }); // 설비/모델 데이터 강제 새로고침 (캐시 우회)
              if (refreshRecords) refreshRecords(); // 실시간 생산 기록 새로고침
            }}
            loading={dashboardLoading || recordsLoading}
          >
            {t('adminDashboard.refresh')}
          </Button>
        </Space>
      </div>

      {/* 데이터 상태 알림 */}
      {!recordsLoading && productionRecords.length === 0 && !recordsError && (
        <Alert
          message={t('adminDashboard.noProductionData')}
          description={t('adminDashboard.noProductionDataDesc')}
          type="warning"
          showIcon
          style={{ marginBottom: 24 }}
          action={
            <Button size="small" onClick={() => window.location.href = '/data-input'}>
              {t('adminDashboard.goToDataInput')}
            </Button>
          }
        />
      )}

      {recordsError && (
        <Alert
          message={t('adminDashboard.dataLoadError')}
          description={`${t('adminDashboard.supabaseConnectionError')}: ${recordsError}`}
          type="error"
          showIcon
          style={{ marginBottom: 24 }}
          action={
            <Button size="small" onClick={() => {
              fetchDashboardData({ force: true });
              if (refreshRecords) refreshRecords();
            }}>
              {t('common:common.retry')}
            </Button>
          }
        />
      )}

      {operationalAlertsError && (
        <Alert
          message={t('alerts.loadError')}
          description={operationalAlertsError}
          type="error"
          showIcon
          style={{ marginBottom: 24 }}
          action={
            <Button size="small" onClick={() => void refreshOperationalAlerts()}>
              {t('common:common.retry')}
            </Button>
          }
        />
      )}

      {/* 주요 지표 카드 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={t('statistics.totalMachines')}
              value={machineStats.total}
              prefix={<DesktopOutlined />}
              suffix={t('statistics.unit')}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={t('statistics.runningMachines')}
              value={machineStats.running}
              prefix={<RiseOutlined />}
              suffix={t('statistics.unit')}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card 
            hoverable
            onClick={() => showMachineStatusDetail('stopped')}
            style={{ cursor: 'pointer' }}
          >
            <Tooltip title={t('alerts.clickForDetails')}>
              <Statistic
                title={t('statistics.maintenanceStop')}
                value={machineStats.maintenance + machineStats.stopped}
                prefix={<WarningOutlined />}
                suffix={t('statistics.unit')}
                valueStyle={{ color: '#faad14' }}
              />
            </Tooltip>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title={t('statistics.overallOee')}
              value={processedData.overallMetrics
                ? (processedData.overallMetrics.oee * 100).toFixed(1)
                : '—'}
              suffix={processedData.overallMetrics ? '%' : undefined}
              valueStyle={{ 
                color: !processedData.overallMetrics ? '#8c8c8c'
                  : processedData.overallMetrics.oee >= 0.85 ? '#52c41a'
                  : processedData.overallMetrics.oee >= 0.65 ? '#faad14' : '#ff4d4f'
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* 비가동 미입력 교대는 OEE에서 제외되므로, 표시된 OEE의 데이터 커버리지를 함께 알린다. */}
      {(() => {
        const aggregated = aggregatedData();
        if (!aggregated || aggregated.recordCount === 0 || aggregated.unreportedCount === 0) {
          return null;
        }

        const ratio = Math.round((aggregated.unreportedCount / aggregated.recordCount) * 100);

        return (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('downtimeReporting.title', {
              count: aggregated.unreportedCount,
              ratio
            })}
            description={
              aggregated.reportedCount > 0 && aggregated.avgOEEReported !== null
                ? t('downtimeReporting.description', {
                    reportedCount: aggregated.reportedCount,
                    reportedOee: aggregated.avgOEEReported.toFixed(1),
                    unreportedCount: aggregated.unreportedCount,
                    invalidCount: aggregated.impossibleCount,
                  })
                : t('downtimeReporting.descriptionNone', {
                    unreportedCount: aggregated.unreportedCount,
                    invalidCount: aggregated.impossibleCount,
                  })
            }
          />
        );
      })()}

      {/* 물리적으로 불가능한 레거시 기록 경고.
          품질 = 양품/생산 이므로 생산이 0이면 OEE 도 0이어야 하는데, 옛 저장 경로가 남긴 기록 중에는
          생산 0 인데 OEE 가 양수인 행이 있다. 이 행들이 평균 OEE·품질을 실제보다 높게 만든다.
          과거 데이터는 복구하지 않기로 했으므로(계산식 변경 전 구간과 동일 방침), 화면이 이 사실을
          숨기지 않도록 규모와 "제외했을 때의 평균"을 함께 표시한다.
          위의 비가동 미입력 경고와는 다른 문제이므로 별도로 구분해 표시한다. */}
      {(() => {
        const aggregated = aggregatedData();
        if (!aggregated || aggregated.recordCount === 0 || aggregated.impossibleCount === 0) {
          return null;
        }

        const ratio = Math.round((aggregated.impossibleCount / aggregated.recordCount) * 100);

        return (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('legacyDataWarning.title', {
              count: aggregated.impossibleCount,
              ratio
            })}
            description={t('legacyDataWarning.description', {
              validOee: aggregated.avgOEEExcludingImpossible === null
                ? '—'
                : aggregated.avgOEEExcludingImpossible.toFixed(1),
              validQuality: aggregated.avgQualityExcludingImpossible === null
                ? '—'
                : aggregated.avgQualityExcludingImpossible.toFixed(1)
            })}
          />
        );
      })()}

      {/* 메인 콘텐츠 */}
      <Row gutter={[16, 16]}>
        {/* 전체 OEE 게이지 */}
        <Col xs={24} lg={8}>
          {processedData.overallMetrics ? (
            <OEEGauge
              metrics={processedData.overallMetrics}
              title={t('chart.overallOeeStatus')}
              size="large"
              showDetails={true}
            />
          ) : (
            <Card title={t('chart.overallOeeStatus')}>
              <Empty description={t('downtimeReporting.oeeUnavailable')} />
            </Card>
          )}
        </Col>

        {/* OEE 추이 차트 */}
        <Col xs={24} lg={16}>
          <OEETrendChart
            data={processedData.trendData}
            title={t('chart.overallOeeTrend')}
            height={400}
            showControls={false}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* 설비 목록 */}
        <Col xs={24} lg={16}>
          <Card
            title={t('table.machineStatus')}
            extra={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#666' }}>{t('table.realtimeUpdate')}</span>
                <span style={{ fontSize: 12, color: '#1890ff' }}>
                  {t('adminDashboard.showingMachines', { total: machineStats.total, count: processedData.machineList.length })}
                </span>
              </div>
            }
          >
            <Table
              columns={machineColumns}
              dataSource={processedData.machineList}
              rowKey="id"
              pagination={{ 
                pageSize: 10, 
                showSizeChanger: false,
                total: dashboardData ? dashboardData.machines.length : processedData.machineList.length,
                showTotal: (total, range) => t('table.machinesRange', { start: range[0], end: range[1], total })
              }}
              size="small"
              loading={dashboardLoading || recordsLoading}
            />
          </Card>
        </Col>

        {/* 알림 및 경고 */}
        <Col xs={24} lg={8}>
          <DashboardAlerts
            notifications={notifications}
            maxDisplay={5}
            onAcknowledge={acknowledgeNotification}
            onViewAll={() => {
              setShowNotificationPanel(true);
            }}
          />
        </Col>
      </Row>

      {/* 실시간 알림 패널 */}
      <Drawer
        title={t('alerts.allAlertsCount', { count: notifications.length + realtimeAlerts.length })}
        placement="right"
        width={500}
        onClose={() => setShowNotificationPanel(false)}
        open={showNotificationPanel}
        className="dark-drawer"
        styles={{
          header: {
            backgroundColor: '#1f1f1f !important',
            color: '#ffffff !important',
            borderBottom: '1px solid #333333 !important'
          },
          body: {
            backgroundColor: '#1f1f1f !important',
            color: '#ffffff !important'
          },
          content: {
            backgroundColor: '#1f1f1f !important'
          },
          wrapper: {
            backgroundColor: 'rgba(0, 0, 0, 0.45) !important'
          }
        }}
        extra={
          <Space>
            <Badge count={combinedCriticalCount} size="small">
              <Button 
                size="small" 
                danger={notificationFilter === 'critical'}
                type={notificationFilter === 'critical' ? 'primary' : 'default'}
                onClick={() => setNotificationFilter(notificationFilter === 'critical' ? 'all' : 'critical')}
              >
                {t('alerts.critical')}
              </Button>
            </Badge>
            <Badge count={combinedUnacknowledgedCount} size="small">
              <Button 
                size="small"
                type={notificationFilter === 'unacknowledged' ? 'primary' : 'default'}
                onClick={() => setNotificationFilter(notificationFilter === 'unacknowledged' ? 'all' : 'unacknowledged')}
              >
                {t('alerts.unacknowledged')}
              </Button>
            </Badge>
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
          <Button onClick={requestNotificationPermission} block>
            {t('alerts.allowBrowserNotifications')}
          </Button>
          {combinedUnacknowledgedCount > 0 && (
            <Button onClick={clearAllVisibleAlerts} block>
              {t('alerts.clearAllCount', { count: combinedUnacknowledgedCount })}
            </Button>
          )}
        </Space>
        
        {(() => {
          // 모든 알림을 하나의 배열로 결합
          const allAlerts = [
            ...notifications.map(notification => ({
              id: notification.id,
              priority: notification.severity,
              // 알림은 번역 키를 들고 다니므로 여기서 현재 언어로 렌더링한다.
              message: t(notification.messageKey, notification.messageParams),
              machineName: notification.machine_name,
              timestamp: notification.created_at,
              acknowledged: notification.acknowledged,
              type: 'general' as const // 일반 알림 표시
            })),
            ...realtimeAlerts.map(alert => ({ ...alert, type: 'realtime' as const }))
          ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

          // 필터링 적용
          const filteredAlerts = allAlerts.filter(alert => {
            if (notificationFilter === 'critical') {
              return alert.priority === 'critical';
            } else if (notificationFilter === 'unacknowledged') {
              return !alert.acknowledged;
            }
            return true; // 'all'인 경우 모든 알림 표시
          });

          return filteredAlerts.length > 0 ? (
            <List
              dataSource={filteredAlerts}
              renderItem={(alert) => (
                <List.Item
                style={{
                  padding: '12px 0',
                  borderLeft: `4px solid ${
                    alert.priority === 'critical' ? '#ff4d4f' :
                    alert.priority === 'high' ? '#fa8c16' :
                    alert.priority === 'medium' ? '#fadb14' : '#52c41a'
                  }`,
                  paddingLeft: 12,
                  marginLeft: -12,
                  backgroundColor: alert.acknowledged ? '#f5f5f5' : '#fff'
                }}
                actions={[
                  !alert.acknowledged && (
                    <Button 
                      key="ack"
                      size="small"
                      type="link"
                      onClick={() => {
                        if (alert.type === 'general') {
                          acknowledgeNotification(alert.id);
                        } else {
                          acknowledgeAlert(alert.id);
                        }
                      }}
                    >
                      {t('alerts.acknowledge')}
                    </Button>
                  )
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <Badge 
                      status={
                        alert.priority === 'critical' ? 'error' :
                        alert.priority === 'high' ? 'warning' : 'processing'
                      }
                    />
                  }
                  title={
                    <div>
                      <Text strong>{alert.machineName && `[${alert.machineName}] `}</Text>
                      <Tag color={
                        alert.priority === 'critical' ? 'red' :
                        alert.priority === 'high' ? 'orange' : 'blue'
                      }>
                        {alert.priority === 'critical' ? t('alerts.critical') :
                         alert.priority === 'high' ? t('alerts.high') : t('alerts.medium')}
                      </Tag>
                      {alert.type === 'general' && (
                        <Tag color="green">{t('alerts.equipment')}</Tag>
                      )}
                    </div>
                  }
                  description={
                    <div>
                      <div>{alert.message}</div>
                      <Text type="secondary" style={{ fontSize: '12px' }}>
                        {new Date(alert.timestamp).toLocaleString()}
                      </Text>
                    </div>
                  }
                />
              </List.Item>
            )}
            />
          ) : (
            <Empty 
              description={
                notificationFilter === 'critical' ? t('alerts.noCriticalAlerts') :
                notificationFilter === 'unacknowledged' ? t('alerts.noUnacknowledgedAlerts') :
                t('alerts.noAlerts')
              }
            />
          );
        })()}
      </Drawer>

      {/* 설비 상태 상세 정보 모달 */}
      <Modal
        title={`${t('alerts.machineStatusDetails')} - ${selectedStatusType === 'maintenance' ? t('alerts.maintenance') : t('alerts.stopOther')}`}
        open={showMachineStatusModal}
        onCancel={() => setShowMachineStatusModal(false)}
        footer={[
          <Button key="close" onClick={() => setShowMachineStatusModal(false)}>
            {t('alerts.close')}
          </Button>
        ]}
        width={800}
      >
        {(() => {
          const statusDetails = getDetailedMachineStatus();
          const machines = selectedStatusType === 'maintenance' 
            ? statusDetails.maintenance 
            : statusDetails.stopped;
          
          // 상태별로 그룹핑
          const groupedMachines = machines.reduce((acc: Record<string, Machine[]>, machine: Machine) => {
            const state = machine.current_state || 'UNKNOWN';
            if (!acc[state]) acc[state] = [];
            acc[state].push(machine);
            return acc;
          }, {});

          return (
            <div>
              {Object.keys(groupedMachines).length === 0 ? (
                <Empty description={t('alerts.noMachinesInStatus')} />
              ) : (
                Object.entries(groupedMachines).map(([state, machineList]: [string, Machine[]]) => (
                  <div key={state} style={{ marginBottom: 16 }}>
                    <h4>
                      <Badge 
                        color={state.includes('NORMAL') ? 'green' : 'orange'} 
                        text={getStatusText(state)}
                      />
                      <span style={{ marginLeft: 8, color: '#666' }}>
                        ({machineList.length}{t('alerts.units')})
                      </span>
                    </h4>
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      marginLeft: 20,
                      marginBottom: 12
                    }}>
                      {machineList.map((machine: Machine) => (
                        <Tag 
                          key={machine.id}
                          color={state.includes('NORMAL') ? 'green' : 'orange'}
                        >
                          {machine.name}
                        </Tag>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })()}
      </Modal>
      </div>
    </Spin>
  );
};
