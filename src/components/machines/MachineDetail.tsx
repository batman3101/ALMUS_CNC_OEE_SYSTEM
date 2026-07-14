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
import type { TFunction } from 'i18next';
import { formatMachineLocation } from '@/utils/machineLocation';
import { useMachinesTranslation } from '@/hooks/useTranslation';

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
interface StateConfigEntry {
  color: string;
  icon: React.ReactNode;
  label: string;
  bgColor: string;
  borderColor: string;
}

const getStateConfig = (state: MachineState, t: TFunction): StateConfigEntry => {
  const configs: Record<MachineState, Omit<StateConfigEntry, 'label'>> = {
    NORMAL_OPERATION: {
      color: 'success',
      icon: <PlayCircleOutlined />,
      bgColor: '#f6ffed',
      borderColor: '#52c41a'
    },
    INSPECTION: {
      color: 'warning',
      icon: <ToolOutlined />,
      bgColor: '#fffbe6',
      borderColor: '#faad14'
    },
    BREAKDOWN_REPAIR: {
      color: 'error',
      icon: <WarningOutlined />,
      bgColor: '#fff2f0',
      borderColor: '#ff4d4f'
    },
    PM_MAINTENANCE: {
      color: 'warning',
      icon: <ToolOutlined />,
      bgColor: '#fffbe6',
      borderColor: '#faad14'
    },
    MODEL_CHANGE: {
      color: 'processing',
      icon: <SettingOutlined />,
      bgColor: '#e6f7ff',
      borderColor: '#1890ff'
    },
    PLANNED_STOP: {
      color: 'default',
      icon: <PauseCircleOutlined />,
      bgColor: '#fafafa',
      borderColor: '#d9d9d9'
    },
    PROGRAM_CHANGE: {
      color: 'processing',
      icon: <SettingOutlined />,
      bgColor: '#e6f7ff',
      borderColor: '#1890ff'
    },
    TOOL_CHANGE: {
      color: 'processing',
      icon: <ToolOutlined />,
      bgColor: '#e6f7ff',
      borderColor: '#1890ff'
    },
    TEMPORARY_STOP: {
      color: 'error',
      icon: <WarningOutlined />,
      bgColor: '#fff2f0',
      borderColor: '#ff4d4f'
    }
  };

  return { ...configs[state], label: t(`states.${state}`) };
};

const MachineDetail: React.FC<MachineDetailProps> = ({
  machine,
  onStatusChange,
  onRefresh,
  language = 'ko'
}) => {
  const { t } = useMachinesTranslation();
  const [, setCurrentTime] = useState(new Date());
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetrics | null>(null);

  // 현재 시간 업데이트 (1초마다)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // 실제 일일 지표 데이터 조회
  useEffect(() => {
    const fetchDailyMetrics = async () => {
      try {
        const today = new Date().toISOString().split('T')[0];

        // machine_logs에서 당일 데이터 조회
        const response = await fetch(`/api/machines/${machine.id}/logs?date=${today}`);
        if (!response.ok) return;

        const { machine_logs } = await response.json();

        if (!machine_logs || machine_logs.length === 0) return;

        // 실제 데이터를 기반으로 지표 계산
        let totalRuntime = 0;
        let downtime = 0;
        const stateHistory: DailyMetrics['stateHistory'] = [];

        machine_logs.forEach((log: MachineLog) => {
          const duration = log.duration || 0;

          if (log.state === 'NORMAL_OPERATION') {
            totalRuntime += duration;
          } else {
            downtime += duration;
          }

          stateHistory.push({
            state: log.state,
            duration: duration,
            startTime: log.start_time,
            endTime: log.end_time || undefined
          });
        });

        const plannedRuntime = 480; // 8시간 (분)
        const availability = plannedRuntime > 0 ? (totalRuntime / plannedRuntime) * 100 : 0;

        const calculatedMetrics: DailyMetrics = {
          totalRuntime,
          plannedRuntime,
          downtime,
          availability,
          stateHistory
        };

        setDailyMetrics(calculatedMetrics);
      } catch (error) {
        console.error('Failed to fetch daily metrics:', error);
      }
    };

    fetchDailyMetrics();
  }, [machine.id]);

  const currentStateConfig = machine.current_state
    ? getStateConfig(machine.current_state, t)
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
                <Text type="secondary">{formatMachineLocation(machine.location, t)}</Text>
                <Divider type="vertical" />
                <Text type="secondary">{machine.production_model?.model_name}</Text>
                <Divider type="vertical" />
                <Text type="secondary">
                  Tact Time: {machine.current_process?.tact_time_seconds}s
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
                {t('systemStatus.refresh')}
              </Button>
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={() => onStatusChange?.(machine)}
              >
                {t('actions.changeState')}
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
                {t('labels.currentState')}
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
                    color={currentStateConfig.color}
                    icon={currentStateConfig.icon}
                    style={{
                      padding: '8px 16px',
                      fontSize: '16px',
                      borderRadius: '8px'
                    }}
                  >
                    {currentStateConfig.label}
                  </Tag>
                </div>

                {stateDuration && (
                  <div style={{ textAlign: 'center' }}>
                    <Statistic
                      title={t('labels.duration')}
                      value={stateDuration.duration}
                      prefix={<ClockCircleOutlined />}
                      valueStyle={{
                        fontSize: '24px',
                        color: stateDuration.minutes > 120 ? '#ff4d4f' : '#1890ff'
                      }}
                    />
                    {stateDuration.minutes > 120 && (
                      <Alert
                        message={t('detail.longDurationWarning')}
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
                    {t('statusChange.noStateInfo')}
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
                {t('detail.dailyMetricsTitle')}
              </Space>
            }
          >
            {dailyMetrics ? (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <Statistic
                      title={t('detail.runtime')}
                      value={Math.floor(dailyMetrics.totalRuntime / 60)}
                      suffix={t('units.hours')}
                      precision={1}
                      valueStyle={{ color: '#52c41a' }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title={t('detail.downtime')}
                      value={Math.floor(dailyMetrics.downtime / 60)}
                      suffix={t('units.hours')}
                      precision={1}
                      valueStyle={{ color: '#ff4d4f' }}
                    />
                  </Col>
                </Row>

                <div>
                  <div style={{ marginBottom: 8 }}>
                    <Text strong>
                      {t('detail.availabilityRate')}
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
                    {t('detail.plannedRuntime', { hours: Math.floor(dailyMetrics.plannedRuntime / 60) })}
                  </Text>
                </div>
              </Space>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <Text type="secondary">
                  {t('operator.loadingData')}
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
                {t('detail.todayStateHistory')}
              </Space>
            }
          >
            {dailyMetrics?.stateHistory ? (
              <Timeline
                items={dailyMetrics.stateHistory.map((item) => {
                  const config = getStateConfig(item.state, t);
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
                            <Tag color={config.color}>
                              {config.label}
                            </Tag>
                            <Text type="secondary" style={{ marginLeft: 8 }}>
                              {t('detail.durationHM', {
                                hours: Math.floor(item.duration / 60),
                                minutes: item.duration % 60
                              })}
                            </Text>
                          </div>
                          <Text type="secondary" style={{ fontSize: '12px' }}>
                            {format(startTime, 'HH:mm')} - {endTime ? format(endTime, 'HH:mm') :
                              t('detail.ongoing')}
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
                  {t('detail.noStateHistory')}
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