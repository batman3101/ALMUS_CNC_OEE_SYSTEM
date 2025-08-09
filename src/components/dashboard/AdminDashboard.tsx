'use client';

import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Statistic, Table, Progress, Alert, Space, Button, Select } from 'antd';
import { 
  DashboardOutlined, 
  DesktopOutlined, 
  WarningOutlined,
  RiseOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { OEEGauge, OEETrendChart } from '@/components/oee';
import { OEEMetrics, Machine } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';



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

interface AdminDashboardProps {
  selectedRole?: 'admin' | 'operator' | 'engineer';
  onRoleChange?: (role: 'admin' | 'operator' | 'engineer') => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ selectedRole, onRoleChange }) => {
  const isClient = useClientOnly();
  const [loading, setLoading] = useState(false);
  const [overallMetrics, setOverallMetrics] = useState<OEEMetrics>(generateMockOverallMetrics());
  const [machineList, setMachineList] = useState(generateMockMachineList());
  const [alerts, setAlerts] = useState(generateMockAlerts());
  const [trendData, setTrendData] = useState(generateMockTrendData());
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'week' | 'month'>('today');

  // 데이터 새로고침 (클라이언트에서만 실행)
  const handleRefresh = async () => {
    setLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      // 새로고침 시에만 약간의 변화를 주되, 하이드레이션 오류를 방지하기 위해 고정값 사용
      const refreshedMetrics = {
        ...generateMockOverallMetrics(),
        oee: 0.69 + (Date.now() % 100) / 1000 // 시간 기반으로 약간의 변화
      };
      setOverallMetrics(refreshedMetrics);
      setMachineList(generateMockMachineList());
      setAlerts(generateMockAlerts());
      setTrendData(generateMockTrendData());
    } catch (error) {
      console.error('데이터 새로고침 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  // 실시간 데이터 업데이트 (클라이언트에서만 실행)
  useEffect(() => {
    if (!isClient) return;
    
    const interval = setInterval(() => {
      // 시간 기반으로 약간의 변화를 주되 일관성 유지
      const timeBasedSeed = Math.floor(Date.now() / 60000); // 1분마다 변경
      const refreshedMetrics = {
        ...generateMockOverallMetrics(),
        oee: 0.69 + (timeBasedSeed % 10) / 100 // 0.69 ~ 0.78 범위
      };
      setOverallMetrics(refreshedMetrics);
      setMachineList(generateMockMachineList());
    }, 60000); // 1분마다 업데이트

    return () => clearInterval(interval);
  }, [isClient]);

  // 설비 상태별 통계
  const machineStats = {
    total: machineList.length,
    running: machineList.filter(m => m.current_state === 'NORMAL_OPERATION').length,
    maintenance: machineList.filter(m => m.current_state === 'MAINTENANCE').length,
    stopped: machineList.filter(m => ['TEMPORARY_STOP', 'PLANNED_STOP'].includes(m.current_state || '')).length,
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
            <p style={{ margin: '4px 0 0 0', color: '#666' }}>전체 설비 현황 및 운영 지표</p>
          </div>
          {/* 역할 선택기 */}
          {isClient && onRoleChange && (
            <div style={{ 
              background: 'white',
              padding: '8px 12px',
              borderRadius: 6,
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              border: '1px solid #d9d9d9'
            }}>
              <Space>
                <span style={{ fontSize: 12, color: '#666' }}>역할 선택:</span>
                <Select
                  value={selectedRole || 'admin'}
                  onChange={onRoleChange}
                  size="small"
                  style={{ width: 100 }}
                  options={[
                    { label: '관리자', value: 'admin' },
                    { label: '운영자', value: 'operator' },
                    { label: '엔지니어', value: 'engineer' }
                  ]}
                />
              </Space>
            </div>
          )}
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
            onClick={handleRefresh}
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
              value={(overallMetrics.oee * 100).toFixed(1)}
              suffix="%"
              valueStyle={{ 
                color: overallMetrics.oee >= 0.85 ? '#52c41a' : 
                       overallMetrics.oee >= 0.65 ? '#faad14' : '#ff4d4f' 
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
            metrics={overallMetrics}
            title="전체 OEE 현황"
            size="large"
            showDetails={true}
          />
        </Col>

        {/* OEE 추이 차트 */}
        <Col xs={24} lg={16}>
          <OEETrendChart
            data={trendData}
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
              dataSource={machineList}
              rowKey="id"
              pagination={{ pageSize: 10, showSizeChanger: false }}
              size="small"
              loading={loading}
            />
          </Card>
        </Col>

        {/* 알림 및 경고 */}
        <Col xs={24} lg={8}>
          <Card title="알림 및 경고" extra={<span style={{ color: '#ff4d4f' }}>{alerts.length}건</span>}>
            <Space direction="vertical" style={{ width: '100%' }}>
              {alerts.map(alert => (
                <Alert
                  key={alert.id}
                  message={`${alert.machine}: ${alert.message}`}
                  description={alert.time}
                  type={alert.severity === 'error' ? 'error' : 'warning'}
                  size="small"
                  showIcon
                />
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
};