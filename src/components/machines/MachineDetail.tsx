'use client';

import React, { useState, useEffect } from 'react';
import { 
  Card, 
  Row, 
  Col, 
  Statistic, 
  Tag, 
  Space, 
  Typography, 
  Button,
  Divider,
  Progress,
  Timeline,
  Alert
} from 'antd';
import { 
  PlayCircleOutlined, 
  PauseCircleOutlined, 
  ToolOutlined,
  WarningOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  SettingOutlined,
  EditOutlined,
  ReloadOutlined,
  TrophyOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
import { Machine, MachineState, MachineLog } from '@/types';
import { formatDistanceToNow, format, differenceInMinutes } from 'date-fns';
import { ko, vi } from 'date-fns/locale';

const { Title, Text } = Typography;

interface MachineDetailProps {
  machine: Machine;
  onStatusChange?: (machine: Machine) => void;
  onRefresh?: () => void;
  language?: 'ko' | 'vi';
}

interface DailyMetrics {
  totalRuntime: number;
  plannedRuntime: number;
  downtime: number;
  availability: number;
  stateHistory: Array<{
    state: MachineState;
    duration: number;
    startTime: string;
    endTime?: string;
  }>;
}

// 설비 상태별 설정
const getStateConfig = (state: MachineState, language: 'ko' | 'vi' = 'ko') => {
  const configs = {
    NORMAL_OPERATION: {
      color: 'success',
      icon: <PlayCircleOutlined />,
      text: { ko: '정상가동', vi: 'Hoạt động bình thường' },
      bgColor: '#f6ffed',
      borderColor: '#52c41a'
    },
    MAINTENANCE: {
      color: 'warning',
      icon: <ToolOutlined />,
      text: { ko: '점검중', vi: 'Bảo trì' },
      bgColor: '#fffbe6',
      borderColor: '#faad14'
    },
    MODEL_CHANGE: {
      color: 'processing',
      icon: <SettingOutlined />,
      text: { ko: '모델교체', vi: 'Thay đổi mô hình' },
      bgColor: '#e6f7ff',
      borderColor: '#1890ff'
    },
    PLANNED_STOP: {
      color: 'default',
      icon: <PauseCircleOutlined />,
      text: { ko: '계획정지', vi: 'Dừng theo kế hoạch' },
      bgColor: '#fafafa',
      borderColor: '#d9d9d9'
    },
    PROGRAM_CHANGE: {
      color: 'processing',
      icon: <SettingOutlined />,
      text: { ko: '프로그램 교체', vi: 'Thay đổi chương trình' },
      bgColor: '#e6f7ff',
      borderColor: '#1890ff'
    },
    TOOL_CHANGE: {
      color: 'processing',
      icon: <ToolOutlined />,
      text: { ko: '공구교환', vi: 'Thay đổi công cụ' },
      bgColor: '#e6f7ff',
      borderColor: '#1890ff'
    },
    TEMPORARY_STOP: {
      color: 'error',
      icon: <WarningOutlined />,
      text: { ko: '일시정지', vi: 'Dừng tạm thời' },
      bgColor: '#fff2f0',
      borderColor: '#ff4d4f'
    }
  };
  
  return configs[state];
};

const MachineDetail: React.FC<MachineDetailProps> = ({
  machine,
  onStatusChange,
  onRefresh,
  language = 'ko'
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetrics | null>(null);

  // 현재 시간 업데이트 (1초마다)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // 임시 일일 지표 데이터 생성
  useEffect(() => {
    // 실제로는 API에서 당일 데이터를 가져와야 함
    const mockDailyMetrics: DailyMetrics = {
      totalRuntime: 420, // 7시간
      plannedRuntime: 480, // 8시간
      downtime: 60, // 1시간
      availability: 87.5,
      stateHistory: [
        {
          state: 'NORMAL_OPERATION',
          duration: 240,
          startTime: '2024-01-15T08:00:00Z',
          endTime: '2024-01-15T12:00:00Z'
        },
        {
          state: 'MAINTENANCE',
          duration: 30,
          startTime: '2024-01-15T12:00:00Z',
          endTime: '2024-01-15T12:30:00Z'
        },
        {
          state: 'NORMAL_OPERATION',
          duration: 180,
          startTime: '2024-01-15T12:30:00Z',
          endTime: '2024-01-15T15:30:00Z'
        },
        {
          state: 'TEMPORARY_STOP',
          duration: 30,
          startTime: '2024-01-15T15:30:00Z',
          endTime: '2024-01-15T16:00:00Z'
        }
      ]
    };
    setDailyMetrics(mockDailyMetrics);
  }, [machine.id]);

  const currentStateConfig = machine.current_state 
    ? getStateConfig(machine.current_state, language)
    : null;

  // 현재 상태 지속 시간 계산 (실제 데이터 기반)
  const getCurrentStateDuration = () => {
    if (!machine.current_state || !machine.updated_at) return null;
    
    // machine.updated_at을 현재 상태 시작 시간으로 사용
    const now = new Date();
    const stateStartTime = new Date(machine.updated_at);
    
    return {
      duration: formatDistanceToNow(stateStartTime, {
        addSuffix: false,
        locale: language === 'ko' ? ko : vi
      }),
      minutes: differenceInMinutes(now, stateStartTime)
    };
  };

  const stateDuration = getCurrentStateDuration();

  // 가동률 색상 결정
  const getAvailabilityColor = (availability: number) => {
    if (availability >= 90) return '#52c41a';
    if (availability >= 80) return '#faad14';
    return '#ff4d4f';
  };

  return (
    <div className="machine-detail">
      {/* 헤더 */}
      <Card style={{ marginBottom: 24 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space direction="vertical" size="small">
              <Title level={2} style={{ margin: 0 }}>
                {machine.name}
              </Title>
              <Space>
                <EnvironmentOutlined />
                <Text type="secondary">{machine.location}</Text>
                <Divider type="vertical" />
                <Text type="secondary">{machine.model_type}</Text>
                <Divider type="vertical" />
                <Text type="secondary">
                  Tact Time: {machine.default_tact_time}s
                </Text>
              </Space>
            </Space>
          </Col>
          <Col>
            <Space>
              <Button 
                icon={<ReloadOutlined />} 
                onClick={onRefresh}
              >
                {language === 'ko' ? '새로고침' : 'Làm mới'}
              </Button>
              <Button 
                type="primary" 
                icon={<EditOutlined />}
                onClick={() => onStatusChange?.(machine)}
              >
                {language === 'ko' ? '상태 변경' : 'Thay đổi trạng thái'}
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Row gutter={[24, 24]}>
        {/* 현재 상태 */}
        <Col xs={24} lg={12}>
          <Card 
            title={
              <Space>
                <ClockCircleOutlined />
                {language === 'ko' ? '현재 상태' : 'Trạng thái hiện tại'}
              </Space>
            }
            style={{
              backgroundColor: currentStateConfig?.bgColor,
              borderColor: currentStateConfig?.borderColor
            }}
          >
            {currentStateConfig ? (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <div style={{ textAlign: 'center' }}>
                  <Tag 
                    color={currentStateConfig.color as any}
                    icon={currentStateConfig.icon}
                    style={{ 
                      padding: '8px 16px', 
                      fontSize: '16px',
                      borderRadius: '8px'
                    }}
                  >
                    {currentStateConfig.text[language]}
                  </Tag>
                </div>
                
                {stateDuration && (
                  <div style={{ textAlign: 'center' }}>
                    <Statistic
                      title={language === 'ko' ? '지속 시간' : 'Thời gian duy trì'}
                      value={stateDuration.duration}
                      prefix={<ClockCircleOutlined />}
                      valueStyle={{ 
                        fontSize: '24px',
                        color: stateDuration.minutes > 120 ? '#ff4d4f' : '#1890ff'
                      }}
                    />
                    {stateDuration.minutes > 120 && (
                      <Alert
                        message={
                          language === 'ko' 
                            ? '장시간 동일 상태가 지속되고 있습니다' 
                            : 'Trạng thái đã duy trì trong thời gian dài'
                        }
                        type="warning"
                        showIcon
                        style={{ marginTop: 12 }}
                      />
                    )}
                  </div>
                )}
              </Space>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <ExclamationCircleOutlined style={{ fontSize: '48px', color: '#d9d9d9' }} />
                <div style={{ marginTop: 16 }}>
                  <Text type="secondary">
                    {language === 'ko' ? '상태 정보 없음' : 'Không có thông tin trạng thái'}
                  </Text>
                </div>
              </div>
            )}
          </Card>
        </Col>

        {/* 당일 누적 지표 */}
        <Col xs={24} lg={12}>
          <Card 
            title={
              <Space>
                <TrophyOutlined />
                {language === 'ko' ? '당일 누적 지표' : 'Chỉ số tích lũy trong ngày'}
              </Space>
            }
          >
            {dailyMetrics ? (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <Statistic
                      title={language === 'ko' ? '가동 시간' : 'Thời gian hoạt động'}
                      value={Math.floor(dailyMetrics.totalRuntime / 60)}
                      suffix={language === 'ko' ? '시간' : 'giờ'}
                      precision={1}
                      valueStyle={{ color: '#52c41a' }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title={language === 'ko' ? '다운타임' : 'Thời gian dừng'}
                      value={Math.floor(dailyMetrics.downtime / 60)}
                      suffix={language === 'ko' ? '시간' : 'giờ'}
                      precision={1}
                      valueStyle={{ color: '#ff4d4f' }}
                    />
                  </Col>
                </Row>

                <div>
                  <div style={{ marginBottom: 8 }}>
                    <Text strong>
                      {language === 'ko' ? '가동률' : 'Tỷ lệ hoạt động'}
                    </Text>
                    <Text style={{ float: 'right' }}>
                      {dailyMetrics.availability.toFixed(1)}%
                    </Text>
                  </div>
                  <Progress
                    percent={dailyMetrics.availability}
                    strokeColor={getAvailabilityColor(dailyMetrics.availability)}
                    showInfo={false}
                  />
                </div>

                <div>
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    {language === 'ko' 
                      ? `계획 가동시간: ${Math.floor(dailyMetrics.plannedRuntime / 60)}시간` 
                      : `Thời gian hoạt động theo kế hoạch: ${Math.floor(dailyMetrics.plannedRuntime / 60)} giờ`
                    }
                  </Text>
                </div>
              </Space>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <Text type="secondary">
                  {language === 'ko' ? '데이터 로딩 중...' : 'Đang tải dữ liệu...'}
                </Text>
              </div>
            )}
          </Card>
        </Col>

        {/* 상태 이력 */}
        <Col xs={24}>
          <Card 
            title={
              <Space>
                <ClockCircleOutlined />
                {language === 'ko' ? '오늘의 상태 이력' : 'Lịch sử trạng thái hôm nay'}
              </Space>
            }
          >
            {dailyMetrics?.stateHistory ? (
              <Timeline
                items={dailyMetrics.stateHistory.map((item, index) => {
                  const config = getStateConfig(item.state, language);
                  const startTime = new Date(item.startTime);
                  const endTime = item.endTime ? new Date(item.endTime) : null;
                  
                  return {
                    dot: config.icon,
                    color: config.color === 'success' ? 'green' : 
                           config.color === 'warning' ? 'orange' :
                           config.color === 'error' ? 'red' : 'blue',
                    children: (
                      <div>
                        <Space direction="vertical" size="small">
                          <div>
                            <Tag color={config.color as any}>
                              {config.text[language]}
                            </Tag>
                            <Text type="secondary" style={{ marginLeft: 8 }}>
                              {Math.floor(item.duration / 60)}
                              {language === 'ko' ? '시간 ' : ' giờ '}
                              {item.duration % 60}
                              {language === 'ko' ? '분' : ' phút'}
                            </Text>
                          </div>
                          <Text type="secondary" style={{ fontSize: '12px' }}>
                            {format(startTime, 'HH:mm')} - {endTime ? format(endTime, 'HH:mm') : 
                              (language === 'ko' ? '진행중' : 'Đang tiến hành')}
                          </Text>
                        </Space>
                      </div>
                    )
                  };
                })}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <Text type="secondary">
                  {language === 'ko' ? '상태 이력이 없습니다' : 'Không có lịch sử trạng thái'}
                </Text>
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default MachineDetail;