'use client';

import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Statistic, Table, Progress, Alert, Space, Button, Select } from 'antd';
import { 
  DashboardOutlined, 
  DesktopOutlined, 
  WarningOutlined,
  RiseOutlined,
  ReloadOutlined,
  WifiOutlined
} from '@ant-design/icons';
import { OEEGauge, OEETrendChart } from '@/components/oee';
import { DashboardAlerts } from '@/components/notifications';
import { OEEMetrics, Machine } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';



// 모의 데이터 생성 함수들 (고정값 사용으로 하이드레이션 오류 방지)
const generateMockOverallMetrics = (): OEEMetrics => ({
  availability: 0.82,
  performance: 0.89,
  quality: 0.94,
  oee: 0.69,
  actual_runtime: 18720, // 전체 설비 합계
  planned_runtime: 22800,
  ideal_runtime: 16800,
  output_qty: 45600,
  defect_qty: 2736
});

const generateMockMachineList = (): Array<Machine & { oee: number; status: string }> => [
  { id: '1', name: 'CNC-001', location: 'A동 1층', model_type: 'DMG MORI', default_tact_time: 120, is_active: true, current_state: 'NORMAL_OPERATION', created_at: '2024-01-01', updated_at: '2024-01-01', oee: 0.85, status: '정상' },
  { id: '2', name: 'CNC-002', location: 'A동 1층', model_type: 'MAZAK', default_tact_time: 90, is_active: true, current_state: 'MAINTENANCE', created_at: '2024-01-01', updated_at: '2024-01-01', oee: 0.72, status: '점검중' },
  { id: '3', name: 'CNC-003', location: 'A동 2층', model_type: 'HAAS', default_tact_time: 150, is_active: true, current_state: 'NORMAL_OPERATION', created_at: '2024-01-01', updated_at: '2024-01-01', oee: 0.91, status: '정상' },
  { id: '4', name: 'CNC-004', location: 'B동 1층', model_type: 'DMG MORI', default_tact_time: 110, is_active: true, current_state: 'TEMPORARY_STOP', created_at: '2024-01-01', updated_at: '2024-01-01', oee: 0.58, status: '일시정지' },
  { id: '5', name: 'CNC-005', location: 'B동 2층', model_type: 'OKUMA', default_tact_time: 130, is_active: true, current_state: 'NORMAL_OPERATION', created_at: '2024-01-01', updated_at: '2024-01-01', oee: 0.78, status: '정상' },
];

const generateMockAlerts = () => [
  { id: 1, machine: 'CNC-004', message: 'OEE 60% 미만 지속', severity: 'error', time: '10분 전' },
  { id: 2, machine: 'CNC-002', message: '점검 시간 초과', severity: 'warning', time: '25분 전' },
  { id: 3, machine: 'CNC-007', message: '불량률 5% 초과', severity: 'warning', time: '1시간 전' },
];

const generateMockTrendData = () => {
  // 고정된 시드 값을 사용하여 일관된 데이터 생성
  const fixedValues = [
    { availability: 0.82, performance: 0.87, quality: 0.95, oee: 0.68, shift: 'A' as const },
    { availability: 0.78, performance: 0.91, quality: 0.93, oee: 0.66, shift: 'B' as const },
    { availability: 0.85, performance: 0.89, quality: 0.96, oee: 0.73, shift: 'A' as const },
    { availability: 0.79, performance: 0.88, quality: 0.94, oee: 0.65, shift: 'B' as const },
    { availability: 0.83, performance: 0.92, quality: 0.97, oee: 0.74, shift: 'A' as const },
    { availability: 0.81, performance: 0.86, quality: 0.95, oee: 0.66, shift: 'B' as const },
    { availability: 0.84, performance: 0.90, quality: 0.96, oee: 0.73, shift: 'A' as const }
  ];
  
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    data.push({
      date: date.toISOString().split('T')[0],
      ...fixedValues[6 - i]
    });
  }
  return data;
};

interface AdminDashboardProps {}

export const AdminDashboard: React.FC<AdminDashboardProps> = () => {
  const isClient = useClientOnly();
  const { user } = useAuth();
  const { notifications, acknowledgeNotification } = useNotifications();
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'week' | 'month'>('today');
  
  // 실시간 데이터 훅 사용
  const { 
    machines, 
    machineLogs, 
    productionRecords, 
    oeeMetrics, 
    loading, 
    error, 
    refresh, 
    isConnected 
  } = useRealtimeData(user?.id, user?.role);

  // 폴백 데이터 (실시간 데이터가 없을 때)
  const [fallbackData, setFallbackData] = useState({
    overallMetrics: generateMockOverallMetrics(),
    machineList: generateMockMachineList(),
    alerts: generateMockAlerts(),
    trendData: generateMockTrendData()
  });

  // 데이터 처리 및 계산
  const processedData = React.useMemo(() => {
    if (machines.length === 0) {
      return fallbackData;
    }

    // 실제 데이터에서 전체 OEE 계산
    const totalOEE = Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.oee, 0) / Math.max(Object.keys(oeeMetrics).length, 1);
    const totalAvailability = Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.availability, 0) / Math.max(Object.keys(oeeMetrics).length, 1);
    const totalPerformance = Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.performance, 0) / Math.max(Object.keys(oeeMetrics).length, 1);
    const totalQuality = Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.quality, 0) / Math.max(Object.keys(oeeMetrics).length, 1);
    
    const overallMetrics: OEEMetrics = {
      availability: totalAvailability,
      performance: totalPerformance,
      quality: totalQuality,
      oee: totalOEE,
      actual_runtime: Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.actual_runtime, 0),
      planned_runtime: Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.planned_runtime, 0),
      ideal_runtime: Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.ideal_runtime, 0),
      output_qty: Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.output_qty, 0),
      defect_qty: Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.defect_qty, 0)
    };

    // 설비 목록에 OEE 정보 추가
    const machineList = machines.map(machine => ({
      ...machine,
      oee: oeeMetrics[machine.id]?.oee || 0,
      status: getStatusText(machine.current_state)
    }));

    // 알림 생성 (OEE 기반)
    const alerts = machineList
      .filter(machine => machine.oee < 0.6 || !machine.current_state || machine.current_state !== 'NORMAL_OPERATION')
      .slice(0, 5)
      .map((machine, index) => ({
        id: index + 1,
        machine: machine.name,
        message: machine.oee < 0.6 ? 'OEE 60% 미만 지속' : 
                 machine.current_state === 'MAINTENANCE' ? '점검 시간 초과' : 
                 '설비 상태 확인 필요',
        severity: machine.oee < 0.5 ? 'error' as const : 'warning' as const,
        time: '실시간'
      }));

    // 추이 데이터 (최근 7일)
    const trendData = generateMockTrendData(); // 실제로는 productionRecords에서 계산

    return {
      overallMetrics,
      machineList,
      alerts,
      trendData
    };
  }, [machines, oeeMetrics, fallbackData]);

  // 상태 텍스트 변환 함수
  const getStatusText = (state?: string) => {
    const stateMap: Record<string, string> = {
      'NORMAL_OPERATION': '정상',
      'MAINTENANCE': '점검중',
      'MODEL_CHANGE': '모델교체',
      'PLANNED_STOP': '계획정지',
      'PROGRAM_CHANGE': '프로그램교체',
      'TOOL_CHANGE': '공구교환',
      'TEMPORARY_STOP': '일시정지'
    };
    return stateMap[state || ''] || '알 수 없음';
  };

  // 설비 상태별 통계
  const machineStats = {
    total: processedData.machineList.length,
    running: processedData.machineList.filter(m => m.current_state === 'NORMAL_OPERATION').length,
    maintenance: processedData.machineList.filter(m => m.current_state === 'MAINTENANCE').length,
    stopped: processedData.machineList.filter(m => ['TEMPORARY_STOP', 'PLANNED_STOP'].includes(m.current_state || '')).length,
  };

  // 테이블 컬럼 정의
  const machineColumns = [
    {
      title: '설비명',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '위치',
      dataIndex: 'location',
      key: 'location',
      width: 120,
    },
    {
      title: '상태',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string, record: { current_state?: string }) => {
        const color = record.current_state === 'NORMAL_OPERATION' ? 'success' : 
                     record.current_state === 'MAINTENANCE' ? 'warning' : 'error';
        return <span style={{ color: color === 'success' ? '#52c41a' : color === 'warning' ? '#faad14' : '#ff4d4f' }}>{status}</span>;
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

  return (
    <div>
      {/* 헤더 */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 'bold' }}>
              <DashboardOutlined style={{ marginRight: 8 }} />
              관리자 대시보드
            </h1>
            <p style={{ margin: '4px 0 0 0', color: '#666' }}>
              전체 설비 현황 및 운영 지표
              {isConnected && (
                <span style={{ marginLeft: 8, color: '#52c41a' }}>
                  <WifiOutlined /> 실시간 연결됨
                </span>
              )}
            </p>
          </div>
        </div>
        <Space>
          <Select
            value={selectedPeriod}
            onChange={setSelectedPeriod}
            options={[
              { label: '오늘', value: 'today' },
              { label: '이번 주', value: 'week' },
              { label: '이번 달', value: 'month' }
            ]}
            style={{ width: 120 }}
          />
          <Button 
            icon={<ReloadOutlined />} 
            onClick={refresh}
            loading={loading}
          >
            새로고침
          </Button>
        </Space>
      </div>

      {/* 주요 지표 카드 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="전체 설비"
              value={machineStats.total}
              prefix={<DesktopOutlined />}
              suffix="대"
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="정상 가동"
              value={machineStats.running}
              prefix={<RiseOutlined />}
              suffix="대"
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="점검/정지"
              value={machineStats.maintenance + machineStats.stopped}
              prefix={<WarningOutlined />}
              suffix="대"
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="전체 OEE"
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
            title="전체 OEE 현황"
            size="large"
            showDetails={true}
          />
        </Col>

        {/* OEE 추이 차트 */}
        <Col xs={24} lg={16}>
          <OEETrendChart
            data={processedData.trendData}
            title="전체 OEE 추이 (최근 7일)"
            height={400}
            showControls={false}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* 설비 목록 */}
        <Col xs={24} lg={16}>
          <Card title="설비 현황" extra={<span style={{ fontSize: 12, color: '#666' }}>실시간 업데이트</span>}>
            <Table
              columns={machineColumns}
              dataSource={processedData.machineList}
              rowKey="id"
              pagination={{ pageSize: 10, showSizeChanger: false }}
              size="small"
              loading={loading}
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
              // 알림 패널 열기 로직은 상위 컴포넌트에서 처리
              console.log('View all notifications');
            }}
          />
        </Col>
      </Row>
    </div>
  );
};