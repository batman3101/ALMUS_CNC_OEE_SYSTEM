'use client';

import React from 'react';
import { 
  Card, 
  Row, 
  Col, 
  Typography, 
  Tag, 
  Progress, 
  Space, 
  Divider,
  Alert,
  Button
} from 'antd';
import { 
  ClockCircleOutlined, 
  DashboardOutlined, 
  BellOutlined,
  EyeOutlined,
  GlobalOutlined
} from '@ant-design/icons';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useOEEThresholds } from '@/hooks/useOEEThresholds';
import { useShiftTime } from '@/hooks/useShiftTime';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';

const { Title, Text } = Typography;

/**
 * 시스템 설정 적용 데모 컴포넌트
 */
const SystemSettingsDemo: React.FC = () => {
  const { 
    getCompanyInfo, 
    getDisplaySettings, 
    getNotificationSettings,
    formatTimeWithTimezone,
    formatNumber
  } = useSystemSettings();
  
  const { getOEEColor, getOEEGrade, analyzeLosses } = useOEEThresholds();
  const { getCurrentShift, getShiftSummary, getTimeUntilShiftEnd } = useShiftTime();

  // 데모 데이터
  const demoOEE = {
    availability: 0.82,
    performance: 0.89,
    quality: 0.94,
    oee: 0.82 * 0.89 * 0.94
  };

  // 자동 새로고침 데모
  const [refreshCount, setRefreshCount] = React.useState(0);
  const { refresh, pause, resume, isActive } = useAutoRefresh(() => {
    setRefreshCount(prev => prev + 1);
  });

  const companyInfo = getCompanyInfo();
  const displaySettings = getDisplaySettings();
  const notificationSettings = getNotificationSettings();
  const currentShift = getCurrentShift();
  const shiftSummary = getShiftSummary();
  const timeUntilShiftEnd = getTimeUntilShiftEnd();
  const oeeAnalysis = analyzeLosses(demoOEE.availability, demoOEE.performance, demoOEE.quality);

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2}>
        <GlobalOutlined style={{ marginRight: '8px' }} />
        시스템 설정 적용 데모
      </Title>
      
      <Alert
        message="실시간 설정 적용"
        description="시스템 설정에서 값을 변경하면 이 페이지의 내용이 실시간으로 업데이트됩니다."
        type="info"
        showIcon
        style={{ marginBottom: '24px' }}
      />

      <Row gutter={[16, 16]}>
        {/* 회사 정보 */}
        <Col xs={24} lg={12}>
          <Card title="회사 정보 설정" size="small">
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text strong>회사명: </Text>
                <Text>{companyInfo.name}</Text>
              </div>
              <div>
                <Text strong>시간대: </Text>
                <Text>{companyInfo.timezone}</Text>
              </div>
              <div>
                <Text strong>언어: </Text>
                <Tag color="blue">{companyInfo.language === 'ko' ? '한국어' : 'Tiếng Việt'}</Tag>
              </div>
              <div>
                <Text strong>현재 시간: </Text>
                <Text>{formatTimeWithTimezone(new Date())}</Text>
              </div>
            </Space>
          </Card>
        </Col>

        {/* 화면 설정 */}
        <Col xs={24} lg={12}>
          <Card title="화면 설정" size="small">
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text strong>새로고침 간격: </Text>
                <Text>{displaySettings.refreshInterval}초</Text>
              </div>
              <div>
                <Text strong>테마 모드: </Text>
                <Tag color={displaySettings.mode === 'dark' ? 'purple' : 'blue'}>
                  {displaySettings.mode === 'dark' ? '다크 모드' : '라이트 모드'}
                </Tag>
              </div>
              <div>
                <Text strong>컴팩트 모드: </Text>
                <Tag color={displaySettings.compactMode ? 'green' : 'default'}>
                  {displaySettings.compactMode ? '활성화' : '비활성화'}
                </Tag>
              </div>
              <div>
                <Text strong>차트 애니메이션: </Text>
                <Tag color={displaySettings.chartAnimation ? 'green' : 'default'}>
                  {displaySettings.chartAnimation ? '활성화' : '비활성화'}
                </Tag>
              </div>
              <div>
                <Text strong>자동 새로고침: </Text>
                <Space>
                  <Tag color={isActive ? 'green' : 'red'}>
                    {isActive ? '활성' : '비활성'}
                  </Tag>
                  <Text type="secondary">({refreshCount}회 새로고침)</Text>
                </Space>
              </div>
              <Space>
                <Button size="small" onClick={refresh}>수동 새로고침</Button>
                <Button size="small" onClick={isActive ? pause : resume}>
                  {isActive ? '일시정지' : '재개'}
                </Button>
              </Space>
            </Space>
          </Card>
        </Col>

        {/* 테마 색상 */}
        <Col xs={24} lg={12}>
          <Card title="테마 색상" size="small">
            <Row gutter={[8, 8]}>
              <Col span={12}>
                <div style={{
                  padding: '12px',
                  backgroundColor: displaySettings.theme.primary,
                  color: 'white',
                  borderRadius: '6px',
                  textAlign: 'center',
                  fontSize: '12px'
                }}>
                  주요 색상
                </div>
              </Col>
              <Col span={12}>
                <div style={{
                  padding: '12px',
                  backgroundColor: displaySettings.theme.success,
                  color: 'white',
                  borderRadius: '6px',
                  textAlign: 'center',
                  fontSize: '12px'
                }}>
                  성공 색상
                </div>
              </Col>
              <Col span={12}>
                <div style={{
                  padding: '12px',
                  backgroundColor: displaySettings.theme.warning,
                  color: 'white',
                  borderRadius: '6px',
                  textAlign: 'center',
                  fontSize: '12px'
                }}>
                  경고 색상
                </div>
              </Col>
              <Col span={12}>
                <div style={{
                  padding: '12px',
                  backgroundColor: displaySettings.theme.error,
                  color: 'white',
                  borderRadius: '6px',
                  textAlign: 'center',
                  fontSize: '12px'
                }}>
                  오류 색상
                </div>
              </Col>
            </Row>
          </Card>
        </Col>

        {/* 교대 정보 */}
        <Col xs={24} lg={12}>
          <Card 
            title={
              <span>
                <ClockCircleOutlined style={{ marginRight: '8px' }} />
                교대 정보
              </span>
            } 
            size="small"
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text strong>현재 교대: </Text>
                <Tag color={currentShift === 'A' ? 'blue' : 'orange'}>
                  {currentShift}교대
                </Tag>
              </div>
              <div>
                <Text strong>교대 종료까지: </Text>
                <Text>{Math.floor(timeUntilShiftEnd / 60)}시간 {timeUntilShiftEnd % 60}분</Text>
              </div>
              <Divider style={{ margin: '12px 0' }} />
              <div>
                <Text strong>A교대: </Text>
                <Text>{shiftSummary.shifts.A.start} - {shiftSummary.shifts.A.end}</Text>
              </div>
              <div>
                <Text strong>B교대: </Text>
                <Text>{shiftSummary.shifts.B.start} - {shiftSummary.shifts.B.end}</Text>
              </div>
              <div>
                <Text strong>운영 효율성: </Text>
                <Text>{shiftSummary.total.efficiency.toFixed(1)}%</Text>
              </div>
            </Space>
          </Card>
        </Col>

        {/* OEE 임계값 적용 */}
        <Col xs={24} lg={12}>
          <Card 
            title={
              <span>
                <DashboardOutlined style={{ marginRight: '8px' }} />
                OEE 임계값 적용
              </span>
            } 
            size="small"
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text strong>OEE: </Text>
                <Progress
                  percent={Math.round(demoOEE.oee * 100)}
                  strokeColor={getOEEColor(demoOEE.oee)}
                  format={(percent) => `${percent}% (${getOEEGrade(demoOEE.oee)}등급)`}
                />
              </div>
              <div>
                <Text strong>가동률: </Text>
                <Text>{formatNumber(demoOEE.availability, 'percentage')}</Text>
              </div>
              <div>
                <Text strong>성능: </Text>
                <Text>{formatNumber(demoOEE.performance, 'percentage')}</Text>
              </div>
              <div>
                <Text strong>품질: </Text>
                <Text>{formatNumber(demoOEE.quality, 'percentage')}</Text>
              </div>
              <div>
                <Text strong>목표 대비 격차: </Text>
                <Text type="secondary">{oeeAnalysis.gapToTarget.toFixed(1)}%p</Text>
              </div>
            </Space>
          </Card>
        </Col>

        {/* 알림 설정 */}
        <Col xs={24} lg={12}>
          <Card 
            title={
              <span>
                <BellOutlined style={{ marginRight: '8px' }} />
                알림 설정
              </span>
            } 
            size="small"
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text strong>브라우저 알림: </Text>
                <Tag color={notificationSettings.browser ? 'green' : 'default'}>
                  {notificationSettings.browser ? '활성화' : '비활성화'}
                </Tag>
              </div>
              <div>
                <Text strong>이메일 알림: </Text>
                <Tag color={notificationSettings.email ? 'green' : 'default'}>
                  {notificationSettings.email ? '활성화' : '비활성화'}
                </Tag>
              </div>
              <div>
                <Text strong>소리 알림: </Text>
                <Tag color={notificationSettings.sound ? 'green' : 'default'}>
                  {notificationSettings.sound ? '활성화' : '비활성화'}
                </Tag>
              </div>
              <div>
                <Text strong>확인 간격: </Text>
                <Text>{notificationSettings.checkInterval}초</Text>
              </div>
              {notificationSettings.emailAddress && (
                <div>
                  <Text strong>수신 이메일: </Text>
                  <Text code>{notificationSettings.emailAddress}</Text>
                </div>
              )}
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default SystemSettingsDemo;