'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Row, Col, Card, Button, Space, Badge, Timeline, Alert, Tabs, Pagination, Table, Segmented } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  ToolOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
  WifiOutlined,
  AppstoreOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { MachineStatusInput } from '@/components/machines';
import { OEEGauge } from '@/components/oee';
import { ProductionRecordInput } from '@/components/production';
import { MachineState } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import { useProductionRecords } from '@/hooks/useProductionRecords';
import { useAuth } from '@/contexts/AuthContext';
import { useMachinesTranslation } from '@/hooks/useTranslation';
import { getCurrentShiftInfo, shouldShowShiftEndNotification, type ShiftTimeConfig } from '@/utils/shiftUtils';
import { getBusinessDateAt } from '@/utils/downtimeIntervals';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { ProgressInputModal } from '@/components/production/ProgressInputModal';
import { useRealtimeProgress } from '@/hooks/useRealtimeProgress';
import { calculateRealtimeProgress } from '@/utils/realtimeProgress';
import { authFetch } from '@/lib/authFetch';

// Removed deprecated TabPane import


const getStateIcon = (state: MachineState) => {
  switch (state) {
    case 'NORMAL_OPERATION':
      return <PlayCircleOutlined style={{ color: '#52c41a' }} />;
    case 'INSPECTION':
      return <ToolOutlined style={{ color: '#faad14' }} />;
    case 'TEMPORARY_STOP':
    case 'PLANNED_STOP':
      return <PauseCircleOutlined style={{ color: '#ff4d4f' }} />;
    default:
      return <ClockCircleOutlined style={{ color: '#1890ff' }} />;
  }
};

const getStateText = (state: MachineState, machinesT: (key: string) => string) => {
  const stateMap = {
    'NORMAL_OPERATION': machinesT('states.NORMAL_OPERATION'),
    'INSPECTION': machinesT('states.INSPECTION'),
    'BREAKDOWN_REPAIR': machinesT('states.BREAKDOWN_REPAIR'),
    'PM_MAINTENANCE': machinesT('states.PM_MAINTENANCE'),
    'MODEL_CHANGE': machinesT('states.MODEL_CHANGE'),
    'PLANNED_STOP': machinesT('states.PLANNED_STOP'),
    'PROGRAM_CHANGE': machinesT('states.PROGRAM_CHANGE'),
    'TOOL_CHANGE': machinesT('states.TOOL_CHANGE'),
    'TEMPORARY_STOP': machinesT('states.TEMPORARY_STOP')
  };
  return stateMap[state] || state;
};

const formatDuration = (minutes: number, machinesT: (key: string) => string): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) {
    return `${hours}${machinesT('units.hours') || '시간'} ${mins}${machinesT('units.minutes') || '분'}`;
  }
  return `${mins}${machinesT('units.minutes') || '분'}`;
};

interface OperatorDashboardProps {
  onError?: (error: Error) => void;
}

export const OperatorDashboard: React.FC<OperatorDashboardProps> = ({ onError }) => {
  useClientOnly();
  const { user } = useAuth();
  const { t: machinesT, language } = useMachinesTranslation();
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [showStatusInput, setShowStatusInput] = useState(false);
  const [showProductionInput, setShowProductionInput] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  // 현재 시각을 state 로 둔다. 주기 자동갱신이 setNow(new Date()) 로 전진시키면
  // 경과시간 기반 지표(교대 진행·가동×성능)가 흐른다. `const now = new Date()` 를
  // 매 렌더 새로 만드는 대신 state 로 두는 이유: (1) 틱 사이에 참조가 안정적이라
  // 아래 realtime useMemo 가 실제로 메모되고, (2) exhaustive-deps 가 "매 렌더 객체 생성"
  // 경고를 내지 않는다. 초기값은 lazy 로 한 번만 계산.
  const [now, setNow] = useState<Date>(() => new Date());

  // 실시간 데이터 훅 사용
  const { 
    machines, 
    machineLogs, 
    oeeMetrics, 
    loading, 
    error, 
    refresh,
    isConnected
  } = useRealtimeData(user?.id, user?.role);

  const { createProductionRecord } = useProductionRecords();
  const { getCompanyInfo, getShiftTimes } = useSystemSettings();


  // 에러 핸들링
  useEffect(() => {
    if (error && onError) {
      onError(new Error(`OperatorDashboard: ${error}`));
    }
  }, [error, onError]);

  // 데이터 처리
  const processedData = React.useMemo(() => {
    try {
      // 운영자의 담당 설비 필터링 (user.assigned_machines 사용)
      const assignedMachineIds = user?.assigned_machines || [];
      
      if (assignedMachineIds.length === 0 || machines.length === 0) {
        return {
          assignedMachines: [],
          recentLogs: []
        };
      }

      // 설비 번호 추출 함수 (예: "CNC-012" -> 12)
      const extractMachineNumber = (name: string): number => {
        const match = name.match(/(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      };

      const assignedMachines = machines
        .filter(machine => assignedMachineIds.includes(machine.id))
        .map(machine => {
          const logs = machineLogs.filter(log => log.machine_id === machine.id);
          const currentLog = logs.find(log => !log.end_time);
          const currentDuration = currentLog
            ? Math.floor((Date.now() - new Date(currentLog.start_time).getTime()) / (1000 * 60))
            : 0;

          return {
            ...machine,
            // 담당 설비는 항상 실제 상태값을 가지고 있다는 것이 이 화면의 전제(카드뷰에서도 machine.current_state! 로 취급)
            current_state: machine.current_state as MachineState,
            // null = OEE 계산 불가(실적 미입력 또는 비가동 미보고). 0% 가 아니다.
            // `|| 0` 이던 시절에는 실적을 아직 안 넣은 설비가 빨간 0.0% 로 표시됐다.
            oee: oeeMetrics?.[machine.id]?.oee ?? null,
            currentDuration,
            // 열린 로그가 정상가동이 아니면 그때부터 지금까지 비가동 중이다.
            // 도색처럼 며칠에 걸친 정지도 같은 방식으로 잡힌다 (machine_logs 는 여러 날을 다룬다).
            downtimeSince:
              currentLog && currentLog.state !== 'NORMAL_OPERATION' ? currentLog.start_time : null,
          };
        })
        // 설비 번호 기준 정렬
        .sort((a, b) => extractMachineNumber(a.name) - extractMachineNumber(b.name));

      // 최근 로그 (담당 설비만)
      const recentLogs = machineLogs
        .filter(log => assignedMachineIds.includes(log.machine_id))
        .slice(0, 10)
        .map(log => ({
          ...log,
          machineName: machines.find(m => m.id === log.machine_id)?.name || 'Unknown'
        }));

      return {
        assignedMachines,
        recentLogs
      };
    } catch (error) {
      console.error('Error processing operator dashboard data:', error);
      if (onError) {
        onError(error as Error);
      }
      return {
        assignedMachines: [],
        recentLogs: []
      };
    }
  }, [machines, machineLogs, oeeMetrics, user, onError]);

  // 상태 변경 핸들러
  const handleStatusChange = async (machineId: string, newState: MachineState) => {
    try {
      console.log(`설비 ${machineId} 상태를 ${newState}로 변경 중...`);
      
      // API 호출하여 설비 상태 변경
      const response = await authFetch(`/api/machines/${machineId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          current_state: newState,
          change_reason: '운영자 수동 변경'
        }),
      });

      const result = await response.json();
      
      if (!response.ok || !result.success) {
        throw new Error(result.message || '상태 변경에 실패했습니다');
      }

      console.log('설비 상태 변경 성공:', result.message);
      setShowStatusInput(false);
      
      // 실시간 데이터 강제 새로고침 (Realtime이 동작하지 않을 경우 대비)
      refresh();
      
    } catch (error: unknown) {
      console.error('상태 변경 실패:', error);
      // 에러 메시지를 사용자에게 표시 (message는 antd에서 import 필요)
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      alert(`상태 변경 실패: ${errorMessage}`);
    }
  };

  // 교대 정보·업무일자는 시스템 설정의 시간대·교대 시간을 기준으로 계산한다
  // (하드코딩된 08:00/20:00·브라우저 로컬 시계 대신 downtimeIntervals 단일 소스에 위임)
  const shiftTimes = getShiftTimes();
  const shiftConfig: ShiftTimeConfig = {
    timezone: getCompanyInfo().timezone,
    shiftAStart: shiftTimes.shiftA.start,
    shiftAEnd: shiftTimes.shiftA.end,
    shiftBStart: shiftTimes.shiftB.start,
    shiftBEnd: shiftTimes.shiftB.end
  };

  // 교대 종료 알림 체크 (설정 기준 종료 15분 전)
  const isShiftEnd = shouldShowShiftEndNotification(now, shiftConfig);

  // 생산 실적 입력에 사용할 업무일자: 설정된 시간대 기준이며, 자정을 넘어 진행 중인 B조는
  // 교대 시작일(전날)을 업무일자로 사용한다 (ShiftDataInputForm과 동일한 단일 소스)
  const currentShiftInfo = getCurrentShiftInfo(now, shiftConfig);
  const productionBusinessDate = getBusinessDateAt(now, shiftConfig.timezone, shiftConfig.shiftAStart);

  // 페이지네이션된 설비 목록
  const paginatedMachines = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return processedData.assignedMachines.slice(startIndex, startIndex + pageSize);
  }, [processedData.assignedMachines, currentPage, pageSize]);

  // 선택한 설비의 OEE 지표. null 이면 계산 불가(실적 미입력 또는 비가동 미보고)이며,
  // OEE 탭은 게이지 대신 "생산 실적을 입력하세요" 빈 상태를 보여준다.
  const selectedMachineMetrics = selectedMachine
    ? (oeeMetrics?.[selectedMachine] ?? null)
    : null;

  // 교대 중 실시간 진행. OEE 는 만들지 않는다 — 불량은 다음날 검사하므로 품질을 모른다.
  const [progressModalOpen, setProgressModalOpen] = useState(false);

  const progress = useRealtimeProgress({
    machineId: selectedMachine,
    date: productionBusinessDate,
    shift: currentShiftInfo.shift,
  });

  const selectedMachineRow = processedData.assignedMachines.find(m => m.id === selectedMachine);

  const realtime = useMemo(() => {
    // 비가동이나 tact 를 모르면 계산하지 않는다. 0 으로 채우면 가동률 100% 로 보인다.
    if (progress.downtimeMinutes === null || progress.tactTimeSeconds === null) return null;
    // 관리자가 휴식 총량을 바꿔 코드 상수와 어긋나면 경과 계획시간이 틀린다.
    // 틀린 숫자를 그럴듯하게 띄우느니 아무 숫자도 내지 않는다.
    if (!progress.breakConfigMatches) return null;

    return calculateRealtimeProgress({
      shift: currentShiftInfo.shift,
      shiftStart: currentShiftInfo.startTime,
      now,
      operatingMinutes: 720,
      tactTimeSeconds: progress.tactTimeSeconds,
      downtimeMinutes: progress.downtimeMinutes,
      shiftOutputQty: progress.lastReportedQty,
    });
  }, [
    progress.downtimeMinutes, progress.tactTimeSeconds, progress.lastReportedQty,
    progress.breakConfigMatches, currentShiftInfo.shift, currentShiftInfo.startTime, now,
  ]);

  // 주기 자동갱신. 원안은 열 때·저장할 때만 갱신돼 그 사이 경과시간 지표가 얼어붙고,
  // 다른 곳에서 기록된 비가동도 저장 전엔 안 보였다. 간격은 하드코딩하지 않고
  // 시스템 설정의 displaySettings.refreshInterval 을 그대로 상속한다(useAutoRefresh 내부).
  //  - setNow: 현재 시각 전진 → 교대 진행·경과 지표가 흐른다 (selectedMachine 유무와 무관)
  //  - progress.refresh: 비가동·마지막 보고 재조회. selectedMachine 이 null 이면 훅 내부
  //    가드로 no-op 이므로 항상 켜도 안전하다. 언마운트 clearInterval 은 useAutoRefresh 가 처리.
  useAutoRefresh(() => {
    setNow(new Date());
    progress.refresh();
  }, true);

  // 테이블 컬럼 정의
  // oee 는 null 을 허용해야 한다 (number? 로 두면 "모름"을 표현하지 못한다).
  type MachineRowData = { id: string; name: string; current_state: MachineState; currentDuration: number; oee: number | null; downtimeSince: string | null };
  const tableColumns = [
    {
      title: machinesT('labels.machineName'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: MachineRowData) => (
        <span
          style={{
            fontWeight: selectedMachine === record.id ? 'bold' : 'normal',
            color: selectedMachine === record.id ? '#1890ff' : 'inherit',
            cursor: 'pointer'
          }}
          onClick={() => setSelectedMachine(record.id)}
        >
          {name}
        </span>
      )
    },
    {
      title: machinesT('labels.currentState'),
      dataIndex: 'current_state',
      key: 'current_state',
      render: (state: MachineState) => (
        <Space>
          {getStateIcon(state)}
          <span>{getStateText(state, machinesT)}</span>
        </Space>
      )
    },
    {
      title: machinesT('labels.duration'),
      dataIndex: 'currentDuration',
      key: 'currentDuration',
      render: (duration: number) => formatDuration(duration, machinesT)
    },
    {
      title: 'OEE',
      dataIndex: 'oee',
      key: 'oee',
      // null 을 number 로 받던 시절에는 `(null * 100).toFixed(1)` 이 조용히 "0.0" 이 되어
      // 계산 불가인 설비가 빨간 0.0% 로 찍혔다. antd 의 render 타입이 느슨해
      // 컴파일러도 잡지 못했다.
      render: (oee: number | null) => (
        <span style={{
          fontWeight: 'bold',
          color: oee === null ? '#8c8c8c'
            : oee >= 0.85 ? '#52c41a'
            : oee >= 0.65 ? '#faad14' : '#ff4d4f'
        }}>
          {oee === null ? '—' : `${(oee * 100).toFixed(1)}%`}
        </span>
      )
    }
  ];

  return (
    <div>
      {/* 헤더 */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 'bold' }}>
              <PlayCircleOutlined style={{ marginRight: 8 }} />
              {machinesT('operator.title')}
            </h1>
            <p style={{ margin: '4px 0 0 0', color: '#666' }}>
              {machinesT('operator.description')}
              {isConnected && (
                <span style={{ marginLeft: 8, color: '#52c41a' }}>
                  <WifiOutlined /> {machinesT('systemStatus.realtimeConnected')}
                </span>
              )}
            </p>
          </div>

        </div>
        <Space>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={refresh}
            loading={loading}
          >
            {machinesT('systemStatus.refresh')}
          </Button>
        </Space>
      </div>

      {/* 교대 종료 알림 */}
      {isShiftEnd && (
        <Alert
          message={machinesT('operator.shiftEndAlert')}
          description={machinesT('operator.shiftEndDescription')}
          type="warning"
          showIcon
          action={
            <Button size="small" onClick={() => setShowProductionInput(true)}>
              {machinesT('operator.inputRecord')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Row gutter={[16, 16]}>
        {/* 담당 설비 현황 */}
        <Col xs={24} lg={16}>
          <Card
              title={machinesT('operator.assignedMachines')}
              extra={
                <Space>
                  <Badge count={processedData.assignedMachines.length} />
                  <Segmented
                    size="small"
                    options={[
                      { value: 'card', icon: <AppstoreOutlined /> },
                      { value: 'table', icon: <UnorderedListOutlined /> }
                    ]}
                    value={viewMode}
                    onChange={(value) => {
                      setViewMode(value as 'card' | 'table');
                      setCurrentPage(1);
                    }}
                  />
                </Space>
              }
            >
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <span>{machinesT('operator.loadingData')}</span>
              </div>
            ) : processedData.assignedMachines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
                <span>{machinesT('operator.noAssignedMachines')}</span>
              </div>
            ) : viewMode === 'card' ? (
              <>
                <Row gutter={[16, 16]}>
                  {paginatedMachines.map(machine => (
                  <Col xs={24} md={12} xl={8} key={machine.id}>
                    <Card
                      size="small"
                      hoverable
                      onClick={() => setSelectedMachine(machine.id)}
                      style={{
                        border: selectedMachine === machine.id ? '2px solid #1890ff' : '1px solid #d9d9d9',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
                          {machine.name}
                        </div>

                        <div style={{ marginBottom: 12 }}>
                          {getStateIcon(machine.current_state!)}
                          <span style={{ marginLeft: 8 }}>
                            {getStateText(machine.current_state!, machinesT)}
                          </span>
                        </div>

                        <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                          {machinesT('labels.duration')}: {formatDuration(machine.currentDuration, machinesT)}
                        </div>

                        <div style={{ fontSize: 14, fontWeight: 'bold' }}>
                          OEE: <span style={{
                            // 계산 불가는 등급을 매기지 않는다. 회색 "—" 로 두어야
                            // "아직 모름"과 "정말 나쁨"이 구분된다.
                            color: machine.oee === null ? '#8c8c8c'
                              : machine.oee >= 0.85 ? '#52c41a'
                              : machine.oee >= 0.65 ? '#faad14' : '#ff4d4f'
                          }}>
                            {machine.oee === null ? '—' : `${(machine.oee * 100).toFixed(1)}%`}
                          </span>
                        </div>
                      </div>
                    </Card>
                  </Col>
                  ))}
                </Row>
                {processedData.assignedMachines.length > pageSize && (
                  <div style={{ marginTop: 16, textAlign: 'center' }}>
                    <Pagination
                      current={currentPage}
                      pageSize={pageSize}
                      total={processedData.assignedMachines.length}
                      onChange={(page) => setCurrentPage(page)}
                      showSizeChanger={false}
                      showTotal={(total, range) => `${range[0]}-${range[1]} / ${total}`}
                    />
                  </div>
                )}
              </>
            ) : (
              <Table
                columns={tableColumns}
                dataSource={processedData.assignedMachines}
                rowKey="id"
                size="small"
                pagination={{
                  current: currentPage,
                  pageSize: pageSize,
                  total: processedData.assignedMachines.length,
                  onChange: (page) => setCurrentPage(page),
                  showSizeChanger: false,
                  showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}`
                }}
                rowClassName={(record) => selectedMachine === record.id ? 'ant-table-row-selected' : ''}
                onRow={(record) => ({
                  onClick: () => setSelectedMachine(record.id),
                  style: { cursor: 'pointer' }
                })}
              />
            )}
            
            {/* 상태 변경 버튼 */}
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <Space>
                <Button 
                  type="primary" 
                  onClick={() => setShowStatusInput(true)}
                  disabled={!selectedMachine}
                >
                  {machinesT('operator.changeState')}
                </Button>
                <Button 
                  onClick={() => setShowProductionInput(true)}
                  disabled={!selectedMachine}
                >
                  {machinesT('operator.inputProduction')}
                </Button>
              </Space>
            </div>
          </Card>
        </Col>

        {/* 사이드 패널 */}
        <Col xs={24} lg={8}>
          <Tabs 
            defaultActiveKey="logs"
            items={[
              {
                key: 'logs',
                label: machinesT('operator.recentWork'),
                children: (
                  <Card size="small">
                    <Timeline
                      items={processedData.recentLogs.slice(0, 8).map(log => ({
                        key: log.log_id,
                        dot: getStateIcon(log.state),
                        color: log.state === 'NORMAL_OPERATION' ? 'green' :
                               log.state === 'INSPECTION' ? 'orange' : 'red',
                        children: (
                          <div style={{ fontSize: 12 }}>
                            <div style={{ fontWeight: 'bold' }}>
                              {log.machineName}
                            </div>
                            <div style={{ color: '#666' }}>
                              {getStateText(log.state, machinesT)}
                            </div>
                            <div style={{ color: '#999' }}>
                              {(() => {
                                const date = new Date(log.start_time);
                                const month = date.getMonth() + 1;
                                const day = date.getDate();
                                const hour = date.getHours().toString().padStart(2, '0');
                                const minute = date.getMinutes().toString().padStart(2, '0');
                                return `${month}${machinesT('units.month') || '월'} ${day}${machinesT('units.day') || '일'} ${hour}:${minute}`;
                              })()}
                            </div>
                          </div>
                        )
                      }))}
                    />
                  </Card>
                )
              },
              {
                key: 'oee',
                label: machinesT('operator.oeeStatus'),
                children: (
                  <>
                    {/* 항목이 없으면 OEE 계산 불가다. 예전에는 훅이 모든 설비에 0% 기본
                        지표를 넣어줘서 이 조건이 항상 참이었고, 아래 "실적을 입력하세요"
                        빈 상태는 도달할 수 없는 죽은 코드였다. */}
                    {selectedMachineMetrics ? (
                      <Card size="small">
                        <OEEGauge
                          metrics={selectedMachineMetrics}
                          title={processedData.assignedMachines.find(m => m.id === selectedMachine)?.name}
                          size="small"
                          showDetails={true}
                        />
                        {/* 교대 중 실시간 가동×성능·진척. 품질(불량)은 검사 전이라 여기 없다. */}
                        {realtime && (
                          <Card size="small" style={{ marginTop: 16 }}>
                            <Space direction="vertical" style={{ width: '100%' }}>
                              <div>
                                {machinesT('operator.realtimeAvailabilityTimesPerformance')}:{' '}
                                <strong>
                                  {realtime.availabilityTimesPerformance === null
                                    ? '—'
                                    : `${(realtime.availabilityTimesPerformance * 100).toFixed(1)}%`}
                                </strong>
                              </div>
                              <div>
                                {machinesT('operator.shiftProgress')}:{' '}
                                <strong>
                                  {realtime.progressQty ?? '—'} / {realtime.capaQty ?? '—'}
                                </strong>
                              </div>
                              <Button type="primary" block onClick={() => setProgressModalOpen(true)}>
                                {machinesT('operator.inputProduction')}
                              </Button>
                            </Space>
                          </Card>
                        )}
                        {/* 여기 도달했다면 지표가 실재한다 = 확인된 진짜 0% 다 (미보고 아님) */}
                        {selectedMachineMetrics.oee === 0 && (
                          <Alert
                            message={machinesT('operator.oeeDataCollecting')}
                            description={machinesT('operator.oeeDataCollectingDesc')}
                            type="info"
                            showIcon
                            style={{ marginTop: 16 }}
                          />
                        )}
                      </Card>
                    ) : selectedMachine ? (
                      <Card size="small">
                        <div style={{ textAlign: 'center', padding: '40px 0' }}>
                          <ClockCircleOutlined style={{ fontSize: 48, color: '#bfbfbf', marginBottom: 16 }} />
                          <div style={{ color: '#666', fontSize: 14 }}>
                            <p style={{ marginBottom: 8 }}>{machinesT('operator.loadingOeeData')}</p>
                            <p style={{ fontSize: 12, color: '#999' }}>
                              {machinesT('operator.inputProductionForOee')}
                            </p>
                          </div>
                          <Button
                            type="primary"
                            size="small"
                            style={{ marginTop: 16 }}
                            onClick={() => setShowProductionInput(true)}
                          >
                            {machinesT('operator.inputProduction')}
                          </Button>
                        </div>
                      </Card>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
                        {machinesT('operator.selectMachine')}
                      </div>
                    )}
                  </>
                )
              }
            ]}
          />
        </Col>
      </Row>

      {/* 상태 입력 모달 */}
      {showStatusInput && selectedMachine && (
        <MachineStatusInput
          machine={processedData.assignedMachines.find(m => m.id === selectedMachine) || null}
          visible={showStatusInput}
          onClose={() => setShowStatusInput(false)}
          onStatusChange={handleStatusChange}
          language={language}
        />
      )}

      {/* 생산 실적 입력 모달 */}
      {showProductionInput && selectedMachine && (
        <ProductionRecordInput
          machine={processedData.assignedMachines.find(m => m.id === selectedMachine) || null}
          shift={currentShiftInfo.shift}
          date={productionBusinessDate}
          visible={showProductionInput}
          onClose={() => setShowProductionInput(false)}
          onSubmit={async (data) => {
            await createProductionRecord({
              machine_id: selectedMachine,
              output_qty: data.output_qty,
              defect_qty: data.defect_qty,
              shift: currentShiftInfo.shift,
              date: productionBusinessDate
            });
            refresh();
          }}
        />
      )}

      {/* 진행 보고 입력 모달 (교대 중 실시간). 비가동 중이면 모달이 입력을 잠근다. */}
      {selectedMachine && selectedMachineRow && (
        <ProgressInputModal
          open={progressModalOpen}
          machineId={selectedMachine}
          machineName={selectedMachineRow.name}
          date={productionBusinessDate}
          shift={currentShiftInfo.shift}
          lastReportedQty={progress.lastReportedQty}
          downtimeSince={selectedMachineRow.downtimeSince}
          onClose={() => setProgressModalOpen(false)}
          onSaved={progress.refresh}
        />
      )}
    </div>
  );
};
