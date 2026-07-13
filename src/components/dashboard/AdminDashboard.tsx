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
import { DateRangeSelector } from '@/components/common/DateRangeSelector';
import { useDateRange } from '@/contexts/DateRangeContext';




interface AdminDashboardProps {
  onError?: (error: Error) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onError }) => {
  const { t, i18n } = useDashboardTranslation();
  const isClient = useClientOnly();
  const { notifications, acknowledgeNotification } = useNotifications();
  const { dateRange, getFormattedRange, preset } = useDateRange();
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<{
    machines: Machine[];
    production: unknown[];
    models: unknown[];
    oeeMetrics: Record<string, OEEMetrics>;
    machinesWithData: string[];
  } | null>(null);
  const [statusDescriptions, setStatusDescriptions] = useState<Array<{
    status: string;
    description_ko: string;
    description_vi: string;
  }>>([]);

  // 실시간 생산 기록 데이터 구독
  const {
    records: productionRecords,
    loading: recordsLoading,
    error: recordsError,
    aggregatedData,
    refreshRecords
  } = useRealtimeProductionRecords();

  // 실시간 알림 시스템 (현재 NotificationContext로 대체하여 비활성화)
  // const {
  //   alerts: realtimeAlerts,
  //   alertStats,
  //   acknowledgeAlert,
  //   clearAllAlerts,
  //   requestNotificationPermission
  // } = useRealtimeNotifications({
  //   productionRecords,
  //   aggregatedData,
  //   machines: [] // TODO: 실제 설비 데이터 연결 필요
  // });

  // 임시 빈 데이터로 대체
  const realtimeAlerts: Array<{
    id: string | number;
    priority: string;
    message: string;
    machineName?: string;
    timestamp: string;
    acknowledged: boolean;
    type?: string;
  }> = [];
  const alertStats = { total: 0, unacknowledged: 0, critical: 0, high: 0, byType: {} };
  const acknowledgeAlert = () => {};
  const clearAllAlerts = () => {};
  const requestNotificationPermission = () => Promise.resolve('granted');

  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [showMachineStatusModal, setShowMachineStatusModal] = useState(false);
  const [selectedStatusType, setSelectedStatusType] = useState<'maintenance' | 'stopped' | null>(null);
  // ✅ 기본 필터를 'unacknowledged'로 변경 (확인된 알림 숨김)
  const [notificationFilter, setNotificationFilter] = useState<'all' | 'critical' | 'unacknowledged'>('unacknowledged');

  const { Text } = Typography;

  // 상태 텍스트 변환 함수 (DB의 상태 설명 데이터 사용)
  const getStatusText = (state?: string) => {
    if (!state || statusDescriptions.length === 0) {
      // 상태 설명 데이터가 없으면 기본 번역 사용
      const stateMap: Record<string, string> = {
        'NORMAL_OPERATION': t('status.normalOperation'),
        'MAINTENANCE': t('status.maintenance'),
        'PM_MAINTENANCE': t('status.maintenance'),
        'INSPECTION': t('status.inspection'),
        'BREAKDOWN_REPAIR': t('status.breakdownRepair'),
        'MODEL_CHANGE': t('status.modelChange'),
        'PLANNED_STOP': t('status.plannedStop'),
        'PROGRAM_CHANGE': t('status.programChange'),
        'TOOL_CHANGE': t('status.toolChange'),
        'TEMPORARY_STOP': t('status.temporaryStop')
      };
      return stateMap[state || ''] || t('status.unknown');
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

    return t('status.unknown');
  };

  // 실시간 OEE 메트릭 계산
  // 주의: aggregatedData는 useCallback으로 반환되는 "함수"이므로 항상 truthy함 - 반드시 호출해서 결과를 확인해야 함
  const calculateRealTimeOEEMetrics = (): OEEMetrics => {
    const aggregated = aggregatedData();

    if (!aggregated || aggregated.recordCount === 0) {
      return {
        availability: 0,
        performance: 0,
        quality: 0,
        oee: 0,
        actual_runtime: 0,
        planned_runtime: 0,
        ideal_runtime: 0,
        output_qty: 0,
        defect_qty: 0
      };
    }

    return {
      availability: aggregated.avgAvailability / 100,
      performance: aggregated.avgPerformance / 100,
      quality: aggregated.avgQuality / 100,
      oee: aggregated.avgOEE / 100,
      actual_runtime: productionRecords.reduce((sum, record) => sum + (record.actual_runtime || 0), 0),
      planned_runtime: productionRecords.reduce((sum, record) => sum + (record.planned_runtime || 0), 0),
      ideal_runtime: productionRecords.reduce((sum, record) => sum + (record.ideal_runtime || 0), 0),
      output_qty: aggregated.totalProduction,
      defect_qty: aggregated.totalDefects
    };
  };

  // 실제 데이터 가져오기
  const fetchDashboardData = async () => {
    try {
      setDashboardLoading(true);

      // 날짜 범위 가져오기
      const formattedRange = getFormattedRange();

      // 병렬로 모든 데이터 가져오기
      const [machinesRes, productionRes, modelsRes, statusDescRes] = await Promise.all([
        fetch('/api/machines', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        }),
        fetch(`/api/production-records?startDate=${formattedRange.startDate}&endDate=${formattedRange.endDate}&limit=1000`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        }),
        fetch('/api/product-models', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        }),
        fetch('/api/machine-status-descriptions', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        })
      ]);

      let machinesData = [];
      let productionData = [];
      let modelsData = [];
      let statusDescriptions = [];

      if (machinesRes.ok) {
        try {
          const data = await machinesRes.json();
          machinesData = Array.isArray(data) ? data : (data.machines || []);
          console.log('Machines data loaded:', machinesData.length);
        } catch (error) {
          console.error('Error parsing machines response:', error);
          machinesData = [];
        }
      } else {
        console.error('Machines API failed:', machinesRes.status);
        machinesData = [];
      }

      if (productionRes.ok) {
        try {
          const data = await productionRes.json();
          productionData = Array.isArray(data) ? data : (data.records || []);
          console.log('Production data loaded:', productionData.length);
        } catch (error) {
          console.error('Error parsing production response:', error);
          productionData = [];
        }
      } else {
        console.error('Production API failed:', productionRes.status);
        productionData = [];
      }

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

      // OEE 계산 (실제 데이터 기반)
      const calculatedOeeMetrics: Record<string, OEEMetrics> = {};
      // 생산 기록이 실제로 존재하는 설비 목록 (전체 OEE 평균 계산 시 데이터 없는 설비 제외용)
      const machinesWithData: string[] = [];

      console.log('Processing OEE calculations for machines:', machinesData.length);

      machinesData.forEach((machine: Machine) => {
        // 해당 설비의 생산 기록 찾기
        interface ProductionData {
          machine_id: string;
          output_qty?: number;
          defect_qty?: number;
          actual_runtime?: number;
          planned_runtime?: number;
          ideal_runtime?: number;
          oee?: number;
          availability?: number;
          performance?: number;
          quality?: number;
        }
        const machineProduction = productionData.filter((p: unknown) => (p as ProductionData).machine_id === machine.id) as ProductionData[];

        if (machineProduction.length > 0) {
          machinesWithData.push(machine.id);
          // ✅ 실제 Supabase 데이터 사용 (hardcoded 값 제거)
          const totalOutput = machineProduction.reduce((sum: number, p: ProductionData) => sum + (p.output_qty || 0), 0);
          const totalDefects = machineProduction.reduce((sum: number, p: ProductionData) => sum + (p.defect_qty || 0), 0);
          const totalActualRuntime = machineProduction.reduce((sum: number, p: ProductionData) => sum + (p.actual_runtime || 0), 0);
          const totalPlannedRuntime = machineProduction.reduce((sum: number, p: ProductionData) => sum + (p.planned_runtime || 0), 0);
          const totalIdealRuntime = machineProduction.reduce((sum: number, p: ProductionData) => sum + (p.ideal_runtime || 0), 0);

          // production_records 테이블의 실제 OEE 값들을 평균내서 사용
          const avgOee = machineProduction.reduce((sum: number, p: ProductionData) => sum + (p.oee || 0), 0) / machineProduction.length;
          const avgAvailability = machineProduction.reduce((sum: number, p: ProductionData) => sum + (p.availability || 0), 0) / machineProduction.length;
          const avgPerformance = machineProduction.reduce((sum: number, p: ProductionData) => sum + (p.performance || 0), 0) / machineProduction.length;
          const avgQuality = machineProduction.reduce((sum: number, p: ProductionData) => sum + (p.quality || 0), 0) / machineProduction.length;

          calculatedOeeMetrics[machine.id] = {
            // ✅ Supabase에서 가져온 실제 값들 사용 (DB에는 0~1 범위로 저장됨)
            availability: avgAvailability,
            performance: avgPerformance,
            quality: avgQuality,
            oee: avgOee,
            actual_runtime: totalActualRuntime,
            planned_runtime: totalPlannedRuntime,
            ideal_runtime: totalIdealRuntime,
            output_qty: totalOutput,
            defect_qty: totalDefects
          };
        } else {
          // 생산 기록이 없는 경우 0으로 설정 (mock 데이터 제거)
          calculatedOeeMetrics[machine.id] = {
            availability: 0,
            performance: 0,
            quality: 0,
            oee: 0,
            actual_runtime: 0,
            planned_runtime: 0,
            ideal_runtime: 0,
            output_qty: 0,
            defect_qty: 0
          };
        }
      });

      // 데이터가 하나도 없으면 에러 처리, 그렇지 않으면 저장
      if (machinesData.length === 0) {
        throw new Error('설비 데이터를 불러올 수 없습니다. API 응답을 확인해주세요.');
      }

      setDashboardData({
        machines: machinesData,
        production: productionData,
        models: modelsData,
        oeeMetrics: calculatedOeeMetrics,
        machinesWithData
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
          production: productionData.length,
          models: modelsData.length,
          oeeMetrics: Object.keys(calculatedOeeMetrics).length
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

  // 데이터 처리 및 계산
  const processedData = React.useMemo(() => {
    try {
      console.log('Processing dashboard data:', {
        dashboardData: dashboardData ? 'exists' : 'null',
        machinesCount: dashboardData?.machines?.length || 0,
        productionRecordsCount: productionRecords.length,
        aggregatedData: aggregatedData ? 'exists' : 'null',
        recordsLoading,
        recordsError,
        selectedPreset: preset,
        dashboardLoading
      });
      
      // 실제 설비 데이터 로깅
      if (dashboardData?.machines?.length > 0) {
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
      if (dashboardData && dashboardData.machines && Array.isArray(dashboardData.machines) && dashboardData.machines.length > 0) {
        console.log('✅ 실제 데이터베이스 데이터 처리 시작 - 설비 수:', dashboardData.machines.length);
        const { machines: dbMachines, oeeMetrics: dbOeeMetrics, machinesWithData: dbMachinesWithData } = dashboardData;

        // 생산 기록이 있는 설비만 전체 OEE 평균 계산에 포함 (데이터 없는 설비의 0%가 평균을 희석시키지 않도록)
        const metricsWithData: OEEMetrics[] = (dbMachinesWithData || [])
          .map(machineId => dbOeeMetrics[machineId])
          .filter((metrics): metrics is OEEMetrics => !!metrics);
        const machinesWithDataCount = metricsWithData.length;

        const totalOEE = machinesWithDataCount > 0 ? metricsWithData.reduce((sum, metrics) => sum + metrics.oee, 0) / machinesWithDataCount : 0;
        const totalAvailability = machinesWithDataCount > 0 ? metricsWithData.reduce((sum, metrics) => sum + metrics.availability, 0) / machinesWithDataCount : 0;
        const totalPerformance = machinesWithDataCount > 0 ? metricsWithData.reduce((sum, metrics) => sum + metrics.performance, 0) / machinesWithDataCount : 0;
        const totalQuality = machinesWithDataCount > 0 ? metricsWithData.reduce((sum, metrics) => sum + metrics.quality, 0) / machinesWithDataCount : 0;

        const overallMetrics: OEEMetrics = {
          availability: totalAvailability,
          performance: totalPerformance,
          quality: totalQuality,
          oee: totalOEE,
          actual_runtime: metricsWithData.reduce((sum, metrics) => sum + metrics.actual_runtime, 0),
          planned_runtime: metricsWithData.reduce((sum, metrics) => sum + metrics.planned_runtime, 0),
          ideal_runtime: metricsWithData.reduce((sum, metrics) => sum + metrics.ideal_runtime, 0),
          output_qty: metricsWithData.reduce((sum, metrics) => sum + metrics.output_qty, 0),
          defect_qty: metricsWithData.reduce((sum, metrics) => sum + metrics.defect_qty, 0)
        };
        
        // 설비 목록에 OEE 정보 추가
        const machineList = dbMachines.map((machine: Machine) => ({
          ...machine,
          oee: dbOeeMetrics[machine.id]?.oee || 0,
          status: getStatusText(machine.current_state)
        }));
        
        // 알림 생성 (OEE 기반)
        type MachineWithOEE = Machine & { oee: number; status: string };
        const alerts = machineList
          .filter((machine: MachineWithOEE) => machine.oee < 0.6 || machine.current_state !== 'NORMAL_OPERATION')
          .slice(0, 5)
          .map((machine: MachineWithOEE, index: number) => ({
            id: index + 1,
            machine: machine.name,
            message: machine.oee < 0.6 ? 'OEE 60% 미만 지속' : 
                     machine.current_state === 'MAINTENANCE' ? '점검 중' : 
                     machine.current_state === 'TEMPORARY_STOP' ? '일시 정지' :
                     '설비 상태 확인 필요',
            severity: machine.oee < 0.5 ? 'error' as const : 'warning' as const,
            time: t('time.realTime')
          }));
        
        // 추이 데이터 - 선택된 기간에 따른 실제 생산 기록에서 계산
        // dateRange를 사용한 필터링
        const filteredRecords = productionRecords
          .filter(record => {
            const recordDate = new Date(record.date);
            return recordDate >= dateRange.startDate && recordDate <= dateRange.endDate;
          })
          .sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateA.getTime() - dateB.getTime();
          });

        console.log('🔍 필터링된 레코드:', {
          selectedPreset: preset,
          dateRange: {
            start: dateRange.startDate.toISOString(),
            end: dateRange.endDate.toISOString()
          },
          totalRecords: productionRecords.length,
          filteredCount: filteredRecords.length,
          dateRange: filteredRecords.length > 0 ? {
            start: filteredRecords[0]?.date,
            end: filteredRecords[filteredRecords.length - 1]?.date
          } : 'No data',
          sampleRecords: filteredRecords.slice(0, 3).map(r => ({
            date: r.date,
            oee: r.oee,
            availability: r.availability
          }))
        });

        // ✅ 날짜별로 집계 (A, B shift 평균) - 차트 가독성 향상
        type DailyAggregatedItem = { date: string; records: typeof productionRecords };
        const dailyAggregated = filteredRecords.reduce((acc: Record<string, DailyAggregatedItem>, record) => {
          const date = record.date;
          if (!acc[date]) {
            acc[date] = {
              date,
              records: []
            };
          }
          acc[date].records.push(record);
          return acc;
        }, {});

        const trendData = Object.values(dailyAggregated).map((item: DailyAggregatedItem) => {
          const records = item.records;
          const avgAvailability = records.reduce((sum: number, r) => sum + (r.availability || 0), 0) / records.length;
          const avgPerformance = records.reduce((sum: number, r) => sum + (r.performance || 0), 0) / records.length;
          const avgQuality = records.reduce((sum: number, r) => sum + (r.quality || 0), 0) / records.length;
          const avgOee = records.reduce((sum: number, r) => sum + (r.oee || 0), 0) / records.length;

          return {
            date: item.date,
            // ✅ Supabase 데이터는 이미 0~1 범위 (0.79 = 79%)
            availability: avgAvailability,
            performance: avgPerformance,
            quality: avgQuality,
            oee: avgOee
          };
        }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

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
          machinesWithDataCount
        };
      }

      // 실시간 생산 기록 데이터가 있으면 사용 (로딩 완료 후)
      // 주의: aggregatedData는 함수이므로 항상 truthy함 - 호출 결과에 실제 집계 데이터(recordCount > 0)가 있는지 확인해야 함
      if (!recordsLoading && productionRecords.length > 0 && aggregatedData().recordCount > 0) {
        console.log('Using realtime production records:', productionRecords.length);
        const realTimeMetrics = calculateRealTimeOEEMetrics();
        
        // 실시간 설비 목록 (설비별 생산 기록에 기반)
        const machineProductionMap = new Map();
        productionRecords.forEach(record => {
          if (!machineProductionMap.has(record.machine_id)) {
            machineProductionMap.set(record.machine_id, []);
          }
          machineProductionMap.get(record.machine_id).push(record);
        });

        const machineList = Array.from(machineProductionMap.entries()).map(([machineId, records]: [string, typeof productionRecords]) => {
          const avgOEE = records.reduce((sum, r) => sum + (r.oee || 0), 0) / records.length;
          
          return {
            id: machineId,
            name: `CNC-${machineId.padStart(3, '0')}`,
            location: 'Production Floor',
            model_type: 'CNC Machine',
            default_tact_time: 120,
            is_active: true,
            current_state: avgOEE > 0.7 ? 'NORMAL_OPERATION' as const : 'MAINTENANCE' as const,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            oee: avgOEE,
            status: getStatusText(avgOEE > 0.7 ? 'NORMAL_OPERATION' : 'MAINTENANCE')
          };
        });

        // 실시간 알림 생성
        const alerts = machineList
          .filter(machine => machine.oee < 0.6)
          .slice(0, 5)
          .map((machine, index) => ({
            id: index + 1,
            machine: machine.name,
            message: machine.oee < 0.6 ? 'OEE 60% 미만 지속' : '설비 상태 확인 필요',
            severity: machine.oee < 0.5 ? 'error' as const : 'warning' as const,
            time: '실시간'
          }));

        // 실시간 productionRecords를 trendData로 변환 (날짜 범위 필터링 포함)
        const filteredRecords = productionRecords
          .filter(record => {
            const recordDate = new Date(record.date);
            return recordDate >= dateRange.startDate && recordDate <= dateRange.endDate;
          })
          .sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateA.getTime() - dateB.getTime();
          });

        // ✅ 날짜별로 집계 (A, B shift 평균) - 차트 가독성 향상
        type DailyAggregatedItem = { date: string; records: typeof productionRecords };
        const dailyAggregated = filteredRecords.reduce((acc: Record<string, DailyAggregatedItem>, record) => {
          const date = record.date;
          if (!acc[date]) {
            acc[date] = {
              date,
              records: []
            };
          }
          acc[date].records.push(record);
          return acc;
        }, {});

        const trendData = Object.values(dailyAggregated).map((item: DailyAggregatedItem) => {
          const records = item.records;
          const avgAvailability = records.reduce((sum: number, r) => sum + (r.availability || 0), 0) / records.length;
          const avgPerformance = records.reduce((sum: number, r) => sum + (r.performance || 0), 0) / records.length;
          const avgQuality = records.reduce((sum: number, r) => sum + (r.quality || 0), 0) / records.length;
          const avgOee = records.reduce((sum: number, r) => sum + (r.oee || 0), 0) / records.length;

          return {
            date: item.date,
            // ✅ Supabase 데이터는 이미 0~1 범위 (0.79 = 79%)
            availability: avgAvailability,
            performance: avgPerformance,
            quality: avgQuality,
            oee: avgOee
          };
        }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        console.log('📊 실시간 차트용 변환된 데이터 (날짜별 집계):', {
          trendDataLength: trendData.length,
          sampleData: trendData.slice(0, 3),
          dateRange: {
            start: dateRange.startDate.toISOString(),
            end: dateRange.endDate.toISOString()
          }
        });

        return {
          overallMetrics: realTimeMetrics,
          machineList,
          alerts,
          trendData, // ✅ 실시간 데이터로 변환된 trendData 반환
          machinesWithDataCount: machineList.length
        };
      }

      // 로딩 중일 때는 빈 데이터 반환 (에러 없이)
      if (recordsLoading || dashboardLoading) {
        console.log('Data is loading, returning empty data');
        return {
          overallMetrics: {
            availability: 0, performance: 0, quality: 0, oee: 0,
            actual_runtime: 0, planned_runtime: 0, ideal_runtime: 0,
            output_qty: 0, defect_qty: 0
          },
          machineList: [],
          alerts: [],
          trendData: [],
          machinesWithDataCount: 0
        };
      }

      // 데이터가 없는 경우 에러 메시지 표시
      console.log('No data available, throwing error');
      throw new Error('설비 데이터를 불러올 수 없습니다. Supabase 연결을 확인해주세요.');
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error processing admin dashboard data:', error);
      }
      // 에러 시 빈 데이터와 에러 메시지 반환
      const errorMessage = (error as Error).message || '데이터를 불러오는데 실패했습니다';
      message.error(errorMessage);
      
      return {
        overallMetrics: {
          availability: 0,
          performance: 0,
          quality: 0,
          oee: 0,
          actual_runtime: 0,
          planned_runtime: 0,
          ideal_runtime: 0,
          output_qty: 0,
          defect_qty: 0
        },
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
  }, [productionRecords, aggregatedData, dashboardData, dashboardData?.machines?.length]);

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
      render: (oee: number) => (
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
    <Spin spinning={dashboardLoading} tip={t('adminDashboard.updatingMessage')}>
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
              fetchDashboardData(); // 대시보드 데이터 새로고침
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
              fetchDashboardData();
              if (refreshRecords) refreshRecords();
            }}>
              {t('common.retry')}
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
              value={(processedData.overallMetrics.oee * 100).toFixed(1)}
              suffix="%"
              valueStyle={{ 
                color: processedData.overallMetrics.oee >= 0.85 ? '#52c41a' : 
                       processedData.overallMetrics.oee >= 0.65 ? '#faad14' : '#ff4d4f' 
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* 메인 콘텐츠 */}
      <Row gutter={[16, 16]}>
        {/* 전체 OEE 게이지 */}
        <Col xs={24} lg={8}>
          <OEEGauge
            metrics={processedData.overallMetrics}
            title={t('chart.overallOeeStatus')}
            size="large"
            showDetails={true}
          />
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
        headerStyle={{
          backgroundColor: '#1f1f1f',
          color: '#ffffff',
          borderBottom: '1px solid #333333'
        }}
        bodyStyle={{
          backgroundColor: '#1f1f1f',
          color: '#ffffff'
        }}
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
            <Badge count={alertStats.critical} size="small">
              <Button 
                size="small" 
                danger={notificationFilter === 'critical'}
                type={notificationFilter === 'critical' ? 'primary' : 'default'}
                onClick={() => setNotificationFilter(notificationFilter === 'critical' ? 'all' : 'critical')}
              >
                {t('alerts.critical')}
              </Button>
            </Badge>
            <Badge count={alertStats.unacknowledged} size="small">
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
          {alertStats.unacknowledged > 0 && (
            <Button onClick={clearAllAlerts} block>
              {t('alerts.clearAllCount', { count: alertStats.unacknowledged })}
            </Button>
          )}
        </Space>
        
        {(() => {
          // 모든 알림을 하나의 배열로 결합
          const allAlerts = [
            ...notifications.map(notification => ({
              id: notification.id,
              priority: notification.severity === 'error' ? 'critical' : 
                       notification.severity === 'warning' ? 'high' : 'medium',
              message: notification.message,
              machineName: notification.machine_name,
              timestamp: notification.created_at,
              acknowledged: notification.acknowledged,
              type: 'general' // 일반 알림 표시
            })),
            ...realtimeAlerts.map(alert => ({ ...alert, type: 'realtime' }))
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
                        <Tag color="green" size="small">{t('alerts.equipment')}</Tag>
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