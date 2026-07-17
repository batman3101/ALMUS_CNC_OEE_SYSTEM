'use client';

import React, { useState, useEffect } from 'react';
import { Alert, Row, Col, Card, Tabs, Select, DatePicker, Button, Space, Table, Statistic, Dropdown, Tag, Badge, Empty } from 'antd';
import { 
  BarChartOutlined, 
  DownloadOutlined,
  FilterOutlined,
  ReloadOutlined,
  RiseOutlined,
  FallOutlined,
  WifiOutlined,
  CheckOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { OEEGauge, IndependentOEETrendChart, DowntimeChart, ProductionChart } from '@/components/oee';
import { DefectRateTrendChart, QualityPerformanceChart, MachineComparisonChart } from '@/components/quality';
import { OEEMetrics } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import { useEngineerData } from '@/hooks/useEngineerData';
import { useMachineOEEStats } from '@/hooks/useMachineOEEStats';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { formatMachineLocation } from '@/utils/machineLocation';

// Removed deprecated TabPane import
const { RangePicker } = DatePicker;

// 설비/위치 필터 교집합이 비어 있을 때, API가 '전체'로 오인하지 않도록 전달하는 존재하지 않는 설비 ID
const NO_MATCHING_MACHINE_ID = '00000000-0000-0000-0000-000000000000';


interface EngineerDashboardProps {
  onError?: (error: Error) => void;
}

export const EngineerDashboard: React.FC<EngineerDashboardProps> = ({ onError }) => {
  useClientOnly();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { getDisplaySettings } = useSystemSettings();
  const isDarkMode = getDisplaySettings().mode === 'dark';
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedPeriod, setSelectedPeriod] = useState<'week' | 'month' | 'quarter'>('month');
  const [selectedMachines, setSelectedMachines] = useState<string[]>(['all']);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
  const [customDateRange, setCustomDateRange] = useState<[string, string] | null>(null);
  const [pageSize, setPageSize] = useState(10);
  
  // 필터 상태
  const [selectedLocations, setSelectedLocations] = useState<string[]>(['all']);
  const [selectedShifts, setSelectedShifts] = useState<string[]>(['all']);
  const [selectedOEEGrades, setSelectedOEEGrades] = useState<string[]>(['all']);
  const [filterDropdownVisible, setFilterDropdownVisible] = useState(false);

  // OEE 등급 분류 함수
  const getOEEGrade = (oee: number): string => {
    if (oee >= 0.85) return 'excellent';  // 우수 (85% 이상)
    if (oee >= 0.75) return 'good';       // 양호 (75-85%)
    if (oee >= 0.65) return 'fair';       // 보통 (65-75%)
    return 'poor';                        // 미흡 (65% 미만)
  };

  const compareNullable = (left: number | null, right: number | null): number => {
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return left - right;
  };

  const oeeGradeLabels = {
    excellent: t('dashboard:oeeGrades.excellent'),
    good: t('dashboard:oeeGrades.good'),
    fair: t('dashboard:oeeGrades.fair'),
    poor: t('dashboard:oeeGrades.poor')
  };

  // 실시간 데이터 훅 사용 (설비 목록과 연결 상태용.
  // 설비별 지표는 아래 useMachineOEEStats 가 기간·교대 필터를 적용해 서버에서 집계한다)
  const {
    machines,
    loading: realtimeLoading,
    error: realtimeError,
    refresh,
    isConnected
  } = useRealtimeData(user?.id, user?.role);

  // 위치 필터에 해당하는 설비 ID 목록 (전체 선택 시 null = 위치 필터 없음)
  const locationMachineIds = React.useMemo(() => {
    if (selectedLocations.length === 0 || selectedLocations.includes('all')) {
      return null;
    }
    return machines
      .filter(machine => machine.location && selectedLocations.includes(machine.location))
      .map(machine => machine.id);
  }, [machines, selectedLocations]);

  // 설비 선택과 위치 필터를 교집합으로 결합 (null = 필터 없음 = 전체)
  const effectiveMachineIds = React.useMemo(() => {
    const machineFilter = selectedMachines.length === 0 || selectedMachines.includes('all')
      ? null
      : selectedMachines;

    if (!machineFilter) return locationMachineIds;
    if (!locationMachineIds) return machineFilter;
    return machineFilter.filter(id => locationMachineIds.includes(id));
  }, [selectedMachines, locationMachineIds]);

  // 다중 설비 선택을 콤마 구분 목록으로 변환 (API 계약: machine_id는 단일 또는 콤마 구분 목록을 허용)
  const selectedMachineIds = React.useMemo(() => {
    if (!effectiveMachineIds) return undefined;
    if (effectiveMachineIds.length === 0) return NO_MATCHING_MACHINE_ID;
    return effectiveMachineIds.join(',');
  }, [effectiveMachineIds]);

  // 설비별 OEE 집계 (기간 + 교대 필터 적용, 서버 SQL 집계).
  // 등급 필터는 이 결과에서 계산되므로 여기서는 걸지 않는다 (순환 방지).
  const { stats: machineStats, loading: machineStatsLoading } = useMachineOEEStats(
    selectedPeriod,
    selectedMachineIds,
    customDateRange,
    selectedShifts
  );

  // OEE 등급 필터가 선택되면 해당 등급의 설비만 남긴다.
  // 데이터가 없는 설비(해당 기간에 실적 없음)는 등급을 매길 수 없으므로 제외한다.
  const gradeFilteredMachineIds = React.useMemo(() => {
    if (selectedOEEGrades.includes('all')) {
      return selectedMachineIds;
    }

    const matching = Object.values(machineStats)
      .filter(stat =>
        stat.reported_records > 0
        && stat.avg_oee !== null
        && selectedOEEGrades.includes(getOEEGrade(stat.avg_oee))
      )
      .map(stat => stat.machine_id);

    if (matching.length === 0) return NO_MATCHING_MACHINE_ID;
    return matching.join(',');
  }, [selectedOEEGrades, machineStats, selectedMachineIds]);

  // 필터 옵션 데이터
  const filterOptions = React.useMemo(() => {
    // machines가 아직 로드되지 않았을 경우 기본값 반환
    if (!machines || machines.length === 0) {
      return {
        locations: [{ value: 'all', label: t('dashboard:filterMenu.allLocations'), count: 0 }],
        shifts: [
          { value: 'all', label: t('dashboard:filterMenu.allShifts'), count: 0 },
          { value: 'A', label: t('dashboard:filterMenu.shiftA'), count: 0 },
          { value: 'B', label: t('dashboard:filterMenu.shiftB'), count: 0 }
        ],
        oeeGrades: [
          { value: 'all', label: t('dashboard:filterMenu.allGrades'), count: 0 },
          { value: 'excellent', label: oeeGradeLabels.excellent, count: 0 },
          { value: 'good', label: oeeGradeLabels.good, count: 0 },
          { value: 'fair', label: oeeGradeLabels.fair, count: 0 },
          { value: 'poor', label: oeeGradeLabels.poor, count: 0 }
        ]
      };
    }

    // 실제 설비 데이터에서 위치 추출
    const locations = [...new Set(machines.map(m => m.location).filter(Boolean))];
    
    // OEE 등급별 설비 분류.
    // 개수와 필터가 같은 근거(기간·교대가 적용된 설비별 집계)를 쓰도록 machineStats 를 사용한다.
    // 이전에는 개수는 "설비별 최신 실적 1건"으로 세고 필터는 날짜별 추세 행에 걸어, 둘이
    // 서로 다른 것을 세고 있었다.
    const machineOeeValues = Object.values(machineStats)
      .filter((stat): stat is typeof stat & { avg_oee: number } =>
        stat.reported_records > 0 && stat.avg_oee !== null
      )
      .map(stat => stat.avg_oee);

    const oeeGrades = {
      excellent: machineOeeValues.filter(oee => getOEEGrade(oee) === 'excellent').length,
      good: machineOeeValues.filter(oee => getOEEGrade(oee) === 'good').length,
      fair: machineOeeValues.filter(oee => getOEEGrade(oee) === 'fair').length,
      poor: machineOeeValues.filter(oee => getOEEGrade(oee) === 'poor').length
    };
    
    return {
      locations: [
        { value: 'all', label: t('dashboard:filterMenu.allLocations'), count: machines.length },
        ...locations.map(loc => ({
          // value 는 DB 원본 값을 유지해야 필터링이 동작한다. 라벨만 번역한다.
          value: loc,
          label: formatMachineLocation(loc, t),
          count: machines.filter(m => m.location === loc).length
        }))
      ],
      shifts: [
        { value: 'all', label: t('dashboard:filterMenu.allShifts'), count: 0 },
        { value: 'A', label: t('dashboard:filterMenu.shiftA'), count: 0 },
        { value: 'B', label: t('dashboard:filterMenu.shiftB'), count: 0 }
      ],
      oeeGrades: [
        { value: 'all', label: t('dashboard:filterMenu.allGrades'), count: machines.length },
        { value: 'excellent', label: oeeGradeLabels.excellent, count: oeeGrades.excellent },
        { value: 'good', label: oeeGradeLabels.good, count: oeeGrades.good },
        { value: 'fair', label: oeeGradeLabels.fair, count: oeeGrades.fair },
        { value: 'poor', label: oeeGradeLabels.poor, count: oeeGrades.poor }
      ]
    };
  }, [machines, machineStats, t]);

  // 활성 필터 개수 계산
  const activeFilterCount = React.useMemo(() => {
    let count = 0;
    if (!selectedLocations.includes('all')) count++;
    if (!selectedShifts.includes('all')) count++;
    if (!selectedOEEGrades.includes('all')) count++;
    return count;
  }, [selectedLocations, selectedShifts, selectedOEEGrades]);

  // 필터 핸들러
  const handleLocationFilter = (location: string) => {
    if (location === 'all') {
      setSelectedLocations(['all']);
    } else {
      setSelectedLocations(prev => {
        const newLocations = prev.filter(l => l !== 'all');
        return newLocations.includes(location)
          ? newLocations.filter(l => l !== location)
          : [...newLocations, location];
      });
    }
  };

  const handleShiftFilter = (shift: string) => {
    if (shift === 'all') {
      setSelectedShifts(['all']);
    } else {
      setSelectedShifts(prev => {
        const newShifts = prev.filter(s => s !== 'all');
        return newShifts.includes(shift)
          ? newShifts.filter(s => s !== shift)
          : [...newShifts, shift];
      });
    }
  };

  const handleOEEGradeFilter = (grade: string) => {
    if (grade === 'all') {
      setSelectedOEEGrades(['all']);
    } else {
      setSelectedOEEGrades(prev => {
        const newGrades = prev.filter(g => g !== 'all');
        return newGrades.includes(grade)
          ? newGrades.filter(g => g !== grade)
          : [...newGrades, grade];
      });
    }
  };

  // 필터 초기화
  const resetFilters = () => {
    setSelectedLocations(['all']);
    setSelectedShifts(['all']);
    setSelectedOEEGrades(['all']);
  };

  // 필터 드롭다운 메뉴 생성
  const filterMenu = (
    <div style={{
      width: 320,
      padding: '12px',
      backgroundColor: isDarkMode ? '#1f1f1f' : '#fff',
      borderRadius: '8px',
      boxShadow: isDarkMode
        ? '0 6px 16px 0 rgba(0, 0, 0, 0.4), 0 3px 6px -4px rgba(0, 0, 0, 0.3), 0 9px 28px 8px rgba(0, 0, 0, 0.2)'
        : '0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)',
      border: isDarkMode ? '1px solid #424242' : '1px solid #f0f0f0',
      color: isDarkMode ? '#ffffff' : 'inherit'
    }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: '14px', color: isDarkMode ? '#ffffff' : 'inherit' }}>{t('dashboard:filterMenu.title')}</span>
        <Button type="link" size="small" onClick={resetFilters}>
          {t('dashboard:buttons.reset')}
        </Button>
      </div>

      {/* 위치 필터 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8, fontSize: '12px', color: isDarkMode ? '#a0a0a0' : '#666' }}>{t('dashboard:filterMenu.machineLocation')}</div>
        <Space wrap size={[4, 4]}>
          {filterOptions.locations.map(option => (
            <Tag
              key={option.value}
              style={{ cursor: 'pointer', userSelect: 'none' }}
              color={selectedLocations.includes(option.value) ? 'blue' : 'default'}
              onClick={() => handleLocationFilter(option.value)}
            >
              {selectedLocations.includes(option.value) && <CheckOutlined style={{ marginRight: 4 }} />}
              {option.label} ({option.count})
            </Tag>
          ))}
        </Space>
      </div>

      {/* 교대 필터 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8, fontSize: '12px', color: isDarkMode ? '#a0a0a0' : '#666' }}>{t('dashboard:filterMenu.shift')}</div>
        <Space wrap size={[4, 4]}>
          {filterOptions.shifts.map(option => (
            <Tag
              key={option.value}
              style={{ cursor: 'pointer', userSelect: 'none' }}
              color={selectedShifts.includes(option.value) ? 'green' : 'default'}
              onClick={() => handleShiftFilter(option.value)}
            >
              {selectedShifts.includes(option.value) && <CheckOutlined style={{ marginRight: 4 }} />}
              {option.label}
            </Tag>
          ))}
        </Space>
      </div>

      {/* OEE 등급 필터 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8, fontSize: '12px', color: isDarkMode ? '#a0a0a0' : '#666' }}>{t('dashboard:filterMenu.oeeGrade')}</div>
        <Space wrap size={[4, 4]}>
          {filterOptions.oeeGrades.map(option => (
            <Tag
              key={option.value}
              style={{ cursor: 'pointer', userSelect: 'none' }}
              color={
                selectedOEEGrades.includes(option.value) 
                  ? option.value === 'excellent' ? 'green'
                  : option.value === 'good' ? 'blue'  
                  : option.value === 'fair' ? 'orange'
                  : option.value === 'poor' ? 'red'
                  : 'purple'
                  : 'default'
              }
              onClick={() => handleOEEGradeFilter(option.value)}
            >
              {selectedOEEGrades.includes(option.value) && <CheckOutlined style={{ marginRight: 4 }} />}
              {option.label} ({option.count})
            </Tag>
          ))}
        </Space>
      </div>

      {/* 활성 필터 표시 */}
      {activeFilterCount > 0 && (
        <div style={{ paddingTop: 12, borderTop: isDarkMode ? '1px solid #424242' : '1px solid #f0f0f0' }}>
          <div style={{ fontSize: '12px', color: isDarkMode ? '#a0a0a0' : '#666', marginBottom: 8 }}>{t('dashboard:filterMenu.appliedFilters')}</div>
          <Space wrap size={[4, 4]}>
            {!selectedLocations.includes('all') && (
              <Tag color="blue" closable onClose={() => setSelectedLocations(['all'])}>
                {t('dashboard:filterMenu.location')}: {selectedLocations.map(loc => formatMachineLocation(loc, t)).join(', ')}
              </Tag>
            )}
            {!selectedShifts.includes('all') && (
              <Tag color="green" closable onClose={() => setSelectedShifts(['all'])}>
                {t('dashboard:filterMenu.shift')}: {selectedShifts.join(', ')}
              </Tag>
            )}
            {!selectedOEEGrades.includes('all') && (
              <Tag color="purple" closable onClose={() => setSelectedOEEGrades(['all'])}>
                {t('dashboard:filterMenu.oeeGrade')}: {selectedOEEGrades.map(grade => oeeGradeLabels[grade as keyof typeof oeeGradeLabels] || grade).join(', ')}
              </Tag>
            )}
          </Space>
        </div>
      )}
    </div>
  );

  // 엔지니어 분석 데이터 훅 사용.
  //
  // OEE 등급 필터가 적용되면 "그 등급에 속한 설비들"로 좁혀서 조회한다. 그래야 카드·추세·
  // 비가동·표가 모두 같은 설비 집합을 말한다.
  // (이전에는 등급 개수는 설비 기준으로 세면서 필터는 날짜별 추세 행에 걸어, 등급을 고르면
  //  "우수한 설비"가 아니라 "우수한 날짜"가 걸러졌다)
  const {
    oeeData,
    downtimeData,
    productionData,
    machineDowntime,
    overallPerformance,
    reportingCoverage,
    loading: engineerDataLoading,
    error: engineerDataError,
    refreshData: refreshEngineerData
  } = useEngineerData(selectedPeriod, gradeFilteredMachineIds, customDateRange, selectedShifts);

  // 데이터 변경 추적을 위한 로깅
  React.useEffect(() => {
    console.log('🎛️ EngineerDashboard - 현재 상태:', {
      selectedPeriod,
      selectedMachine: selectedMachines[0] !== 'all' ? selectedMachines[0] : 'all',
      oeeDataLength: oeeData.length,
      downtimeDataLength: downtimeData.length,
      productionDataLength: productionData.length,
      loading: engineerDataLoading,
      error: engineerDataError
    });
    
    if (oeeData.length > 0) {
      console.log('📊 OEE 데이터 샘플:', oeeData.slice(0, 3));
    }
    if (downtimeData.length > 0) {
      console.log('⏰ 다운타임 데이터 샘플:', downtimeData.slice(0, 3));
    }
  }, [selectedPeriod, oeeData, downtimeData, productionData, engineerDataLoading, engineerDataError, selectedMachines]);

  const loading = realtimeLoading || engineerDataLoading || machineStatsLoading;
  const error = realtimeError || engineerDataError;

  // 기본 빈 데이터 구조
  const getEmptyData = () => ({
    overallMetrics: null as OEEMetrics | null,
    analysisData: [],
    trendData: [],
    downtimeData: [],
    productionData: []
  });

  // 에러 핸들링
  useEffect(() => {
    if (error && onError) {
      onError(new Error(`EngineerDashboard: ${error}`));
    }
  }, [error, onError]);

  // 기간/설비/날짜범위/교대 필터 변경시 데이터 재조회는 useEngineerData 훅이 단독으로 담당한다
  // (이 컴포넌트에서 별도로 refreshEngineerData를 호출하면 훅의 자체 effect와 중복 호출된다)

  // 데이터 처리 및 분석
  //
  // 등급 필터는 더 이상 여기서 추세 행을 거르지 않는다. gradeFilteredMachineIds 로 조회 자체를
  // 좁히므로, oeeData/downtimeData/productionData 는 이미 "선택된 등급의 설비들"만 담고 있다.
  const processedData = React.useMemo(() => {
    try {
      // 기간별 API 데이터가 있을 때는 API 데이터를 우선 사용
      let overallMetrics: OEEMetrics | null;

      if (
        overallPerformance
        && overallPerformance.avg_availability !== null
        && overallPerformance.avg_performance !== null
        && overallPerformance.avg_quality !== null
        && overallPerformance.avg_oee !== null
      ) {
        overallMetrics = {
          availability: overallPerformance.avg_availability,
          performance: overallPerformance.avg_performance,
          quality: overallPerformance.avg_quality,
          oee: overallPerformance.avg_oee,
          // 기간 합계(분). 표시는 OEEGauge 가 shiftCount 로 교대 평균 환산한다.
          actual_runtime: overallPerformance.total_actual_runtime,
          planned_runtime: overallPerformance.total_planned_runtime,
          ideal_runtime: overallPerformance.total_ideal_runtime,
          output_qty: overallPerformance.total_output_qty,
          defect_qty: overallPerformance.total_defect_qty
        };
      // 예전에는 여기서 oeeData(일별 추이)를 다시 평균내는 폴백이 있었다. 그 경로는
      // 두 가지 이유로 삭제했다.
      //   1) 도달할 수 없다 — avg_* 가 null 이 되는 경우(보고 기록 0건, 계획시간 0)에는
      //      일별 행도 모두 null 이라 useEngineerData 에서 걸러져 oeeData 가 빈 배열이 된다.
      //      두 값은 같은 응답에서 함께 설정되고 함께 비워지므로 어긋날 수 없다.
      //   2) 도달하더라도 거짓말만 한다 — OEETrendData 에는 runtime·수량 필드가 없어
      //      가동시간과 생산량을 0 으로 지어낼 수밖에 없었다. 실제로 그 0 이 화면에
      //      "실제 가동시간 0분" 으로 찍혔다.
      // 집계는 overall_performance 하나만 신뢰한다. 없으면 없다고 말한다.
      } else {
        overallMetrics = null;
      }

      // 설비별 분석 데이터.
      //
      // 근거를 전부 바꿨다:
      //   OEE/가용성/성능/품질 -> machineStats (기간·교대 필터가 적용된 SQL 집계)
      //   비가동 시간          -> machineDowntime (downtime-analysis 의 설비별 집계, 같은 필터)
      // 이전에는 각각 "설비별 최신 실적 1건"과 "전역 최근 로그 100개"였다. 후자는 800대 중
      // 34대만 커버해서 나머지 766대의 비가동이 항상 0으로 표시됐다.
      const analysisData = machines
        .filter(machine => !effectiveMachineIds || effectiveMachineIds.includes(machine.id))
        .map(machine => {
          const stat = machineStats[machine.id];
          const downtime = machineDowntime[machine.id];
          const hasData = Boolean(
            stat
            && stat.reported_records > 0
            && stat.avg_oee !== null
            && stat.avg_availability !== null
            && stat.avg_performance !== null
            && stat.avg_quality !== null
          );
          const hasProductionData = Boolean(stat && stat.total_records > 0);

          return {
            key: machine.id,
            machine: machine.name,
            location: machine.location,
            hasData,
            hasProductionData,
            recordCount: stat?.total_records ?? 0,
            avgOEE: stat?.avg_oee ?? null,
            availability: stat?.avg_availability ?? null,
            performance: stat?.avg_performance ?? null,
            quality: stat?.avg_quality ?? null,
            downtimeHours: Math.round(((downtime?.totalDowntime ?? 0) / 60) * 10) / 10,
            defectRate: stat && stat.total_output > 0 ? stat.total_defect / stat.total_output : 0,
            trend: 'neutral' as const,
            trendValue: 0
          };
        });

      return {
        overallMetrics,
        analysisData,
        trendData: oeeData,
        downtimeData,
        productionData
      };
    } catch (error) {
      console.error('Error processing engineer dashboard data:', error);
      if (onError) {
        onError(error as Error);
      }
      return getEmptyData();
    }
  }, [machines, machineStats, machineDowntime, effectiveMachineIds, overallPerformance, oeeData, downtimeData, productionData, onError]);

  // 등급 필터가 걸리면 그 등급의 설비만 표에 남긴다 (카드·추세와 같은 설비 집합).
  const filteredAnalysisData = React.useMemo(() => {
    if (selectedOEEGrades.includes('all')) {
      return processedData.analysisData;
    }
    return processedData.analysisData.filter(
      item => item.hasData
        && item.avgOEE !== null
        && selectedOEEGrades.includes(getOEEGrade(item.avgOEE))
    );
  }, [processedData.analysisData, selectedOEEGrades]);

  // 비교 차트는 숫자 OEE가 있는 설비만 그린다. 미보고 설비는 표와 coverage에는
  // 그대로 남기되, 차트에 0점으로 투입해 저성과 설비처럼 보이게 하지 않는다.
  const comparisonData = React.useMemo(() => filteredAnalysisData.flatMap(item => {
    if (
      !item.hasData
      || item.avgOEE === null
      || item.availability === null
      || item.performance === null
      || item.quality === null
    ) {
      return [];
    }
    return [{
      ...item,
      avgOEE: item.avgOEE,
      availability: item.availability,
      performance: item.performance,
      quality: item.quality,
    }];
  }), [filteredAnalysisData]);

  // 실제 설비 목록 옵션 생성 (Supabase 데이터만 사용)
  const machineOptions = React.useMemo(() => {
    const options = [{ label: t('dashboard:table.all'), value: 'all' }];
    if (machines.length > 0) {
      machines.forEach(machine => {
        options.push({ label: machine.name, value: machine.id });
      });
    }
    // machines가 없으면 "전체" 옵션만 반환 (Mock 데이터 제거)
    return options;
  }, [machines, t]);

  // 데이터 내보내기
  const handleExport = () => {
    const exportData = {
      timestamp: new Date().toISOString(),
      period: selectedPeriod,
      machines: selectedMachines,
      ...processedData
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `engineer-analysis-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 분석 테이블 컬럼
  const analysisColumns = [
    {
      title: t('dashboard:table.machineName'),
      dataIndex: 'machine',
      key: 'machine',
      width: 100,
      fixed: 'left' as const,
      sorter: (a: { machine: string }, b: { machine: string }) => a.machine.localeCompare(b.machine),
    },
    {
      title: t('dashboard:table.location'),
      dataIndex: 'location',
      key: 'location',
      width: 120,
      // 정렬은 DB 원본 값 기준으로 두고, 표시만 번역한다.
      sorter: (a: { location: string }, b: { location: string }) => a.location.localeCompare(b.location),
      render: (location: string) => formatMachineLocation(location, t),
    },
    {
      title: t('dashboard:table.oee'),
      dataIndex: 'avgOEE',
      key: 'avgOEE',
      width: 100,
      // 선택한 기간에 실적이 없는 설비는 0%가 아니라 "데이터 없음"이다.
      // 0%로 표시하면 "이 설비는 완전히 멈춰 있었다"로 읽혀 실제와 다르다.
      render: (value: number | null, record: { hasData: boolean }) =>
        record.hasData ? (
          <span style={{
            color: (value ?? 0) >= 0.85 ? '#52c41a' : (value ?? 0) >= 0.65 ? '#faad14' : '#ff4d4f',
            fontWeight: 'bold'
          }}>
            {((value ?? 0) * 100).toFixed(1)}%
          </span>
        ) : (
          <span style={{ color: '#8c8c8c' }}>—</span>
        ),
      sorter: (a: { avgOEE: number | null }, b: { avgOEE: number | null }) =>
        compareNullable(a.avgOEE, b.avgOEE),
    },
    {
      title: t('dashboard:table.availability'),
      dataIndex: 'availability',
      key: 'availability',
      width: 100,
      render: (value: number | null, record: { hasData: boolean }) =>
        record.hasData ? `${((value ?? 0) * 100).toFixed(1)}%` : '—',
      sorter: (a: { availability: number | null }, b: { availability: number | null }) =>
        compareNullable(a.availability, b.availability),
    },
    {
      title: t('dashboard:table.performance'),
      dataIndex: 'performance',
      key: 'performance',
      width: 100,
      render: (value: number | null, record: { hasData: boolean }) =>
        record.hasData ? `${((value ?? 0) * 100).toFixed(1)}%` : '—',
      sorter: (a: { performance: number | null }, b: { performance: number | null }) =>
        compareNullable(a.performance, b.performance),
    },
    {
      title: t('dashboard:table.quality'),
      dataIndex: 'quality',
      key: 'quality',
      width: 100,
      render: (value: number | null, record: { hasData: boolean }) =>
        record.hasData ? `${((value ?? 0) * 100).toFixed(1)}%` : '—',
      sorter: (a: { quality: number | null }, b: { quality: number | null }) =>
        compareNullable(a.quality, b.quality),
    },
    {
      title: t('dashboard:table.downtimeHours'),
      dataIndex: 'downtimeHours',
      key: 'downtimeHours',
      width: 120,
      render: (value: number) => `${value}h`,
      sorter: (a: { downtimeHours: number }, b: { downtimeHours: number }) => a.downtimeHours - b.downtimeHours,
    },
    {
      title: t('dashboard:table.defectRate'),
      dataIndex: 'defectRate',
      key: 'defectRate',
      width: 100,
      render: (value: number, record: { hasProductionData: boolean }) =>
        record.hasProductionData ? `${(value * 100).toFixed(2)}%` : '—',
      sorter: (a: { defectRate: number }, b: { defectRate: number }) => a.defectRate - b.defectRate,
    },
    {
      title: t('dashboard:table.trend'),
      dataIndex: 'trend',
      key: 'trend',
      width: 100,
      render: (trend: string, record: { trendValue: number }) => (
        <span style={{ color: trend === 'up' ? '#52c41a' : '#ff4d4f' }}>
          {trend === 'up' ? <RiseOutlined /> : <FallOutlined />}
          {record.trendValue.toFixed(1)}%
        </span>
      ),
      sorter: (a: { trendValue: number }, b: { trendValue: number }) => a.trendValue - b.trendValue,
    },
  ];

  return (
    <div>
      {/* 헤더 */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 'bold' }}>
              <BarChartOutlined style={{ marginRight: 8 }} />
              {t('dashboard:engineerDashboard.title')}
            </h1>
            <p style={{ margin: '4px 0 0 0', color: '#666' }}>
              {t('dashboard:engineerDashboard.description')}
              {isConnected && (
                <span style={{ marginLeft: 8, color: '#52c41a' }}>
                  <WifiOutlined /> {t('dashboard:adminDashboard.connectedRealtime')}
                </span>
              )}
            </p>
          </div>

        </div>
        <Space>
          <Select
            value={selectedPeriod}
            onChange={(value) => {
              console.log('🔄 기간 변경 요청:', value);
              setSelectedPeriod(value);
              setCustomDateRange(null); // 기간 변경시 커스텀 날짜 범위 초기화
            }}
            options={[
              { label: t('dashboard:filters.thisWeek'), value: 'week' },
              { label: t('dashboard:engineerDashboard.timeFilter.recent1Month'), value: 'month' },
              { label: t('dashboard:filters.thisMonth') + ' x3', value: 'quarter' }
            ]}
            style={{ width: 120 }}
          />
          <RangePicker
            value={customDateRange ? [dayjs(customDateRange[0]), dayjs(customDateRange[1])] : null}
            onChange={(dates, dateStrings) => {
              if (dates && dates[0] && dates[1] && dateStrings[0] && dateStrings[1]) {
                console.log('📅 커스텀 날짜 범위 선택:', dateStrings);
                setCustomDateRange([dateStrings[0], dateStrings[1]]);
              } else {
                console.log('📅 커스텀 날짜 범위 초기화');
                setCustomDateRange(null);
              }
            }}
            format="YYYY-MM-DD"
            placeholder={[t('dashboard:time.startDate'), t('dashboard:time.endDate')]}
            // 200px 은 "YYYY-MM-DD → YYYY-MM-DD" 를 담지 못해 끝자리가 잘렸다
            // (입력칸 63px vs 필요 72px). 측정 기준 240px 부터 여유가 생긴다.
            style={{ width: 260 }}
          />
          <Dropdown
            overlay={filterMenu}
            trigger={['click']}
            open={filterDropdownVisible}
            onOpenChange={setFilterDropdownVisible}
            placement="bottomLeft"
          >
            <Button icon={<FilterOutlined />} style={{ position: 'relative' }}>
              {t('dashboard:buttons.filter')}
              {activeFilterCount > 0 && (
                <Badge
                  count={activeFilterCount}
                  size="small"
                  style={{
                    position: 'absolute',
                    top: -5,
                    right: -5,
                    backgroundColor: '#1890ff'
                  }}
                />
              )}
            </Button>
          </Dropdown>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={() => {
              refresh();
              refreshEngineerData();
            }}
            loading={loading}
          >
            {t('dashboard:adminDashboard.refresh')}
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={handleExport}
          >
            {t('dashboard:buttons.export')}
          </Button>
        </Space>
      </div>

      {reportingCoverage?.incomplete && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('dashboard:downtimeReporting.title', {
            count: reportingCoverage.excluded_records,
            ratio: Math.round((1 - reportingCoverage.reporting_rate) * 100),
          })}
          description={reportingCoverage.reported_records > 0
            ? t('dashboard:downtimeReporting.description', {
                reportedCount: reportingCoverage.reported_records,
                unreportedCount: reportingCoverage.unreported_records,
                invalidCount: reportingCoverage.invalid_records,
              })
            : t('dashboard:downtimeReporting.descriptionNone', {
                unreportedCount: reportingCoverage.unreported_records,
                invalidCount: reportingCoverage.invalid_records,
              })}
        />
      )}

      {error && (
        <Alert
          type="error"
          showIcon
          message={t('dashboard:engineerDashboard.dataLoadError')}
          description={error}
          style={{ marginBottom: 24 }}
          action={
            <Button size="small" onClick={() => refreshEngineerData()}>
              {t('common:common.retry')}
            </Button>
          }
        />
      )}

      {/* 주요 지표 요약
       *
       * 아직 안 온 데이터를 "없음(—)"으로 그리면 안 된다. 조회가 10초 가까이 걸리는
       * 구간이 있어 사용자에게는 "기록이 없다"로 읽힌다. 첫 로딩(값이 아직 없음)에는
       * 스켈레톤을 띄우고, 갱신 중(값이 이미 있음)에는 이전 값을 유지한다. */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}>
          <Card loading={loading && !processedData.overallMetrics}>
            <Statistic
              title={t('dashboard:engineerDashboard.averageOee')}
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
        <Col xs={12} sm={6}>
          <Card loading={loading && !processedData.overallMetrics}>
            <Statistic
              title={t('dashboard:engineerDashboard.averageAvailability')}
              value={processedData.overallMetrics
                ? (processedData.overallMetrics.availability * 100).toFixed(1)
                : '—'}
              suffix={processedData.overallMetrics ? '%' : undefined}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card loading={loading && !processedData.overallMetrics}>
            <Statistic
              title={t('dashboard:engineerDashboard.averagePerformance')}
              value={processedData.overallMetrics
                ? (processedData.overallMetrics.performance * 100).toFixed(1)
                : '—'}
              suffix={processedData.overallMetrics ? '%' : undefined}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card loading={loading && !processedData.overallMetrics}>
            <Statistic
              title={t('dashboard:engineerDashboard.averageQuality')}
              value={processedData.overallMetrics
                ? (processedData.overallMetrics.quality * 100).toFixed(1)
                : '—'}
              suffix={processedData.overallMetrics ? '%' : undefined}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 메인 분석 탭 */}
      <Tabs 
        activeKey={activeTab} 
        onChange={setActiveTab}
        items={[
          {
            key: 'overview',
            label: t('dashboard:engineerDashboard.analysis.collision'),
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={8}>
                  {processedData.overallMetrics ? (
                    <OEEGauge
                      metrics={processedData.overallMetrics}
                      title={t('dashboard:engineerDashboard.charts.overallOeeStatus')}
                      size="large"
                      showDetails={true}
                      // 전사 게이지의 runtime 은 전체 설비 × 전체 일자 합계라 수백만 분이
                      // 된다. 교대 1회 평균으로 환산해야 계획 660분과 비교가 된다.
                      // 분모는 반드시 reported_records 다 — runtime 합계가 RPC 에서
                      // oee_reported 로 필터돼 있어 records_count 로 나누면 평균이 작아진다.
                      shiftCount={reportingCoverage?.reported_records}
                    />
                  ) : (
                    // 조회 중에는 "기록이 없다"고 단정하지 않는다. 아직 모르는 것과
                    // 없는 것은 다르다 — loading=true 면 Card 가 스켈레톤을 그린다.
                    <Card
                      title={t('dashboard:engineerDashboard.charts.overallOeeStatus')}
                      loading={loading}
                    >
                      <Empty description={t('dashboard:downtimeReporting.oeeUnavailable')} />
                    </Card>
                  )}
                </Col>
                <Col xs={24} lg={16}>
                  <IndependentOEETrendChart
                    title={t('dashboard:engineerDashboard.charts.oeeTrendAnalysis')}
                    height={400}
                    externalPeriod={selectedPeriod}
                    onPeriodChange={setSelectedPeriod}
                    customDateRange={customDateRange}
                    machineId={selectedMachineIds}
                    selectedShifts={selectedShifts}
                  />
                </Col>
              </Row>
            )
          },
          {
            key: 'machines',
            label: t('dashboard:engineerDashboard.analysis.performance'),
            children: (
              <Card title={t('dashboard:table.machinePerformanceAnalysis')} extra={
                <Space>
                  <Select
                    mode="multiple"
                    value={selectedMachines}
                    onChange={setSelectedMachines}
                    placeholder={t('dashboard:filters.machine')}
                    style={{ minWidth: 200 }}
                    options={machineOptions}
                  />
                </Space>
              }>
                <Table
                  columns={analysisColumns}
                  dataSource={filteredAnalysisData}
                  pagination={{
                    pageSize: pageSize,
                    showSizeChanger: true,
                    pageSizeOptions: ['10', '20', '30', '50'],
                    onShowSizeChange: (current, size) => setPageSize(size),
                    showQuickJumper: true,
                    showTotal: (total, range) =>
                      t('dashboard:table.itemsRange', { start: range[0], end: range[1], total })
                  }}
                  scroll={{ x: 1000 }}
                  size="small"
                  loading={loading}
                />
              </Card>
            )
          },
          {
            key: 'downtime',
            label: t('dashboard:engineerDashboard.analysis.downtime'),
            children: (
              <DowntimeChart
                data={processedData.downtimeData}
                title={t('dashboard:chart.downtimeRootCauseAnalysis')}
                height={500}
                showTable={true}
              />
            )
          },
          {
            key: 'productivity',
            label: t('dashboard:engineerDashboard.analysis.productivity'),
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24}>
                  <ProductionChart
                    data={processedData.productionData}
                    title={t('dashboard:chart.productivityTrendAnalysis')}
                    height={400}
                    chartType={chartType}
                    showControls={true}
                    onChartTypeChange={setChartType}
                  />
                </Col>
              </Row>
            )
          },
          {
            key: 'quality',
            label: t('dashboard:engineerDashboard.analysis.quality'),
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                  <Card title={t('dashboard:cardTitles.defectRateTrend')}>
                    <DefectRateTrendChart
                      data={processedData.productionData}
                      height={300}
                      period={selectedPeriod}
                    />
                  </Card>
                </Col>
                <Col xs={24} lg={12}>
                  <Card title={t('dashboard:cardTitles.qualityPerformance')}>
                    <QualityPerformanceChart
                      data={processedData.productionData}
                      height={300}
                      period={selectedPeriod}
                    />
                  </Card>
                </Col>
              </Row>
            )
          },
          {
            key: 'comparison',
            label: t('dashboard:engineerDashboard.analysis.comparison'),
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24}>
                  <Card title={t('dashboard:cardTitles.machineComparison')} extra={
                    <Space>
                      <RangePicker
                        value={customDateRange ? [dayjs(customDateRange[0]), dayjs(customDateRange[1])] : null}
                        onChange={(dates, dateStrings) => {
                          if (dates && dates[0] && dates[1] && dateStrings[0] && dateStrings[1]) {
                            setCustomDateRange([dateStrings[0], dateStrings[1]]);
                          } else {
                            setCustomDateRange(null);
                          }
                        }}
                        format="YYYY-MM-DD"
                        placeholder={[t('dashboard:time.startDate'), t('dashboard:time.endDate')]}
                      />
                      <Select
                        value={chartType}
                        onChange={setChartType}
                        options={[
                          { label: t('dashboard:chartTypes.bar'), value: 'bar' },
                          { label: t('dashboard:chartTypes.line'), value: 'line' }
                        ]}
                        style={{ width: 100 }}
                      />
                    </Space>
                  }>
                    <MachineComparisonChart
                      data={comparisonData}
                      height={550}
                      chartType={chartType}
                      onChartTypeChange={setChartType}
                      selectedMachines={selectedMachines}
                    />
                  </Card>
                </Col>
              </Row>
            )
          }
        ]}
      />
    </div>
  );
};
