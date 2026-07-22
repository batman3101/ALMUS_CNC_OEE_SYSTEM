'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Row, Col, Card, Button, Space, Badge, Timeline, Alert, Pagination, Table, Segmented, Drawer, Grid, AutoComplete, Empty } from 'antd';
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
import { MachineState } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import { useAuth } from '@/contexts/AuthContext';
import { useMachinesTranslation } from '@/hooks/useTranslation';
import { getCurrentShiftInfo, shouldShowShiftEndNotification, type ShiftTimeConfig } from '@/utils/shiftUtils';
import { getBusinessDateAt } from '@/utils/downtimeIntervals';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { MachineConsole } from '@/components/dashboard/operator-console/MachineConsole';

const { useBreakpoint } = Grid;

const matchesMachineQuery = (machineName: string, rawQuery: string): boolean => {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return true;

  const machineNumber = machineName.match(/(\d+)$/)?.[1] ?? '';
  const numericQuery = query.replace(/\D/g, '');
  return machineName.toLocaleLowerCase().includes(query)
    || (numericQuery.length > 0 && machineNumber.includes(numericQuery));
};

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
  const isClient = useClientOnly();
  const { user } = useAuth();
  const { t: machinesT } = useMachinesTranslation();
  const screens = useBreakpoint();
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [machineQuery, setMachineQuery] = useState('');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;
  const isCompactConsole = isClient && !screens.lg;
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

  const { getCompanyInfo, getShiftTimes } = useSystemSettings();


  // 에러 핸들링
  useEffect(() => {
    if (error && onError) {
      onError(new Error(`OperatorDashboard: ${error}`));
    }
  }, [error, onError]);

  useEffect(() => {
    if (!isCompactConsole) {
      setConsoleOpen(false);
    }
  }, [isCompactConsole]);

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

  const filteredMachines = useMemo(() => {
    return processedData.assignedMachines.filter(machine =>
      matchesMachineQuery(machine.name, machineQuery)
    );
  }, [machineQuery, processedData.assignedMachines]);

  const machineSearchOptions = useMemo(() => {
    if (!machineQuery.trim()) return [];
    return filteredMachines.slice(0, 20).map(machine => ({
      value: machine.name,
      label: (
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <strong>{machine.name}</strong>
          <span>{getStateIcon(machine.current_state)} {getStateText(machine.current_state, machinesT)}</span>
        </Space>
      )
    }));
  }, [filteredMachines, machineQuery, machinesT]);

  useEffect(() => {
    setCurrentPage(1);
  }, [machineQuery]);

  // 페이지네이션된 설비 목록
  const paginatedMachines = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredMachines.slice(startIndex, startIndex + pageSize);
  }, [filteredMachines, currentPage, pageSize]);

  // 선택한 설비의 OEE 지표. null 이면 계산 불가(실적 미입력 또는 비가동 미보고)다.
  const selectedMachineMetrics = selectedMachine
    ? (oeeMetrics?.[selectedMachine] ?? null)
    : null;

  const selectedMachineRow = processedData.assignedMachines.find(m => m.id === selectedMachine);

  const handleMachineSelect = (machineId: string) => {
    setSelectedMachine(machineId);
    if (isCompactConsole) {
      setConsoleOpen(true);
    }
  };

  // 주기 자동갱신: 현재 시각 전진 → 교대 진행 컨텍스트(currentShiftInfo/isShiftEnd)가 흐른다.
  // 선택 설비의 실시간 지표·진척·비가동·백로그 갱신은 MachineConsole 이 자체적으로 처리한다.
  useAutoRefresh(() => {
    setNow(new Date());
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
          onClick={() => handleMachineSelect(record.id)}
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

  const renderRecentWork = () => (
    <Card size="small" title={machinesT('operator.recentWork')}>
      <Timeline
        items={processedData.recentLogs.slice(0, 8).map(log => ({
          key: log.log_id,
          dot: getStateIcon(log.state),
          color: log.state === 'NORMAL_OPERATION' ? 'green' :
                 log.state === 'INSPECTION' ? 'orange' : 'red',
          children: (
            <div style={{ fontSize: 12 }}>
              <div style={{ fontWeight: 'bold' }}>{log.machineName}</div>
              <div style={{ color: '#666' }}>{getStateText(log.state, machinesT)}</div>
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
  );

  const renderWorkConsole = () => {
    if (!selectedMachine || !selectedMachineRow) {
      return (
        <Card size="small">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={machinesT('operator.selectMachine')} />
        </Card>
      );
    }

    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <MachineConsole
          machineId={selectedMachine}
          machineName={selectedMachineRow.name}
          currentState={selectedMachineRow.current_state as MachineState}
          downtimeSince={selectedMachineRow.downtimeSince}
          date={productionBusinessDate}
          shift={currentShiftInfo.shift}
          confirmedMetrics={selectedMachineMetrics}
        />
        {renderRecentWork()}
      </Space>
    );
  };

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
          style={{ marginBottom: 16 }}
        />
      )}

      <Row gutter={[16, 16]}>
        {/* 담당 설비 현황 */}
        <Col xs={24} lg={8} data-testid="machine-list-panel">
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
            styles={{
              body: isCompactConsole
                ? undefined
                : { maxHeight: 'calc(100vh - 230px)', overflowY: 'auto' }
            }}
          >
            <AutoComplete
              data-testid="machine-number-search"
              allowClear
              size="large"
              value={machineQuery}
              options={machineSearchOptions}
              placeholder={machinesT('operator.searchMachine')}
              onSearch={setMachineQuery}
              onChange={setMachineQuery}
              onSelect={(machineName) => {
                const machine = processedData.assignedMachines.find(item => item.name === machineName);
                if (machine) {
                  setMachineQuery(machine.name);
                  handleMachineSelect(machine.id);
                }
              }}
              style={{ width: '100%', marginBottom: 16 }}
            />
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <span>{machinesT('operator.loadingData')}</span>
              </div>
            ) : processedData.assignedMachines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
                <span>{machinesT('operator.noAssignedMachines')}</span>
              </div>
            ) : filteredMachines.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={machinesT('operator.noMatchingMachines')} />
            ) : viewMode === 'card' ? (
              <>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isCompactConsole ? 'repeat(auto-fit, minmax(220px, 1fr))' : '1fr',
                  gap: 16
                }}>
                  {paginatedMachines.map(machine => (
                    <Card
                      key={machine.id}
                      size="small"
                      hoverable
                      role="button"
                      tabIndex={0}
                      aria-label={`${machine.name} ${machinesT('operator.openWorkConsole')}`}
                      onClick={() => handleMachineSelect(machine.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleMachineSelect(machine.id);
                        }
                      }}
                      style={{
                        border: selectedMachine === machine.id ? '2px solid #1890ff' : '1px solid #d9d9d9',
                        cursor: 'pointer',
                        minHeight: 176
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
                            color: machine.oee === null ? '#8c8c8c'
                              : machine.oee >= 0.85 ? '#52c41a'
                              : machine.oee >= 0.65 ? '#faad14' : '#ff4d4f'
                          }}>
                            {machine.oee === null ? '—' : `${(machine.oee * 100).toFixed(1)}%`}
                          </span>
                        </div>
                        <div style={{ marginTop: 12, color: '#1677ff', fontWeight: 600 }}>
                          {machinesT('operator.openWorkConsole')}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
                {filteredMachines.length > pageSize && (
                  <div style={{ marginTop: 16, textAlign: 'center' }}>
                    <Pagination
                      current={currentPage}
                      pageSize={pageSize}
                      total={filteredMachines.length}
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
                dataSource={filteredMachines}
                rowKey="id"
                size="small"
                pagination={{
                  current: currentPage,
                  pageSize: pageSize,
                  total: filteredMachines.length,
                  onChange: (page) => setCurrentPage(page),
                  showSizeChanger: false,
                  showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}`
                }}
                rowClassName={(record) => selectedMachine === record.id ? 'ant-table-row-selected' : ''}
                onRow={(record) => ({
                  onClick: () => handleMachineSelect(record.id),
                  style: { cursor: 'pointer' }
                })}
              />
            )}
          </Card>
        </Col>

        {!isCompactConsole && (
          <Col xs={24} lg={16} data-testid="work-console-panel">
            <div style={{
              position: 'sticky',
              top: 16,
              maxHeight: 'calc(100vh - 96px)',
              overflowY: 'auto',
              paddingRight: 4
            }}>
              {renderWorkConsole()}
            </div>
          </Col>
        )}
      </Row>

      <Drawer
        title={selectedMachineRow
          ? `${selectedMachineRow.name} · ${machinesT('operator.workConsole')}`
          : machinesT('operator.workConsole')}
        open={isCompactConsole && consoleOpen}
        onClose={() => setConsoleOpen(false)}
        placement="right"
        width="100%"
        styles={{
          header: { position: 'sticky', top: 0, zIndex: 5 },
          body: { padding: 16, background: 'var(--ant-color-bg-layout, #f5f5f5)' }
        }}
      >
        {renderWorkConsole()}
      </Drawer>


    </div>
  );
};
