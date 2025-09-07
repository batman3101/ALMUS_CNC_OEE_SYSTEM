'use client';

import React, { useState } from 'react';
import { Card, Typography, Space, Button, DatePicker, TimePicker, Table, Row, Col, Tag } from 'antd';
import { RefreshIcon } from 'lucide-react';
import { useSystemSettings } from '@/hooks/useSystemSettings';

const { Title, Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

interface DateTimeFormatDemoProps {
  className?: string;
}

export const DateTimeFormatDemo: React.FC<DateTimeFormatDemoProps> = ({ className }) => {
  const { 
    getCompanyInfo,
    formatDate,
    formatTime,
    formatDateTime,
    formatRelative,
    formatCalendar,
    formatDateRange,
    formatCustom,
    getCurrentTime,
    getAntdDateFormat,
    getAntdTimeFormat
  } = useSystemSettings();
  
  const [refreshTime, setRefreshTime] = useState(new Date());
  
  const companyInfo = getCompanyInfo();
  const currentTime = getCurrentTime();
  
  // 테스트 날짜들
  const testDates = [
    new Date(),
    new Date(Date.now() - 24 * 60 * 60 * 1000), // 어제
    new Date(Date.now() + 24 * 60 * 60 * 1000), // 내일
    new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2일 전
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 일주일 전
  ];

  const formatExamples = [
    {
      key: 'current',
      label: '현재 시간',
      value: formatDateTime(new Date()),
      description: '시스템 설정 기반 날짜+시간 형식'
    },
    {
      key: 'date',
      label: '날짜만',
      value: formatDate(new Date()),
      description: '시스템 설정 기반 날짜 형식'
    },
    {
      key: 'time',
      label: '시간만',
      value: formatTime(new Date()),
      description: '시스템 설정 기반 시간 형식'
    },
    {
      key: 'relative',
      label: '상대 시간',
      value: formatRelative(new Date(Date.now() - 2 * 60 * 60 * 1000)),
      description: '2시간 전 기준'
    },
    {
      key: 'calendar',
      label: '달력 형식',
      value: formatCalendar(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      description: '어제 기준'
    },
    {
      key: 'range',
      label: '날짜 범위',
      value: formatDateRange(
        new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        new Date()
      ),
      description: '3일 전부터 오늘까지'
    },
    {
      key: 'custom',
      label: '커스텀 형식',
      value: formatCustom(new Date(), 'YYYY년 MM월 DD일 dddd'),
      description: '커스텀 한국어 형식'
    }
  ];

  const tableColumns = [
    {
      title: '형식',
      dataIndex: 'label',
      key: 'label',
      width: 120,
    },
    {
      title: '결과',
      dataIndex: 'value',
      key: 'value',
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '설명',
      dataIndex: 'description',
      key: 'description',
      render: (desc: string) => <Text type="secondary">{desc}</Text>,
    }
  ];

  const handleRefresh = () => {
    setRefreshTime(new Date());
  };

  return (
    <div className={className}>
      <Card>
        <div style={{ marginBottom: 24 }}>
          <Title level={3}>날짜/시간 형식 시스템 데모</Title>
          <Paragraph>
            현재 시스템 설정에 따른 날짜/시간 형식을 확인할 수 있습니다.
          </Paragraph>
        </div>

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card title="현재 시스템 설정" size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <Text strong>회사명:</Text> <Tag color="blue">{companyInfo.name}</Tag>
                </div>
                <div>
                  <Text strong>타임존:</Text> <Tag color="green">{companyInfo.timezone}</Tag>
                </div>
                <div>
                  <Text strong>언어:</Text> <Tag color="orange">{companyInfo.language}</Tag>
                </div>
                <div>
                  <Text strong>날짜 형식:</Text> <Tag color="purple">{companyInfo.dateFormat}</Tag>
                </div>
                <div>
                  <Text strong>시간 형식:</Text> <Tag color="cyan">{companyInfo.timeFormat}</Tag>
                </div>
                <div>
                  <Text strong>Ant Design 날짜 형식:</Text> <Tag color="magenta">{getAntdDateFormat()}</Tag>
                </div>
                <div>
                  <Text strong>Ant Design 시간 형식:</Text> <Tag color="red">{getAntdTimeFormat()}</Tag>
                </div>
              </Space>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card 
              title="실시간 시계" 
              size="small"
              extra={
                <Button 
                  icon={<RefreshIcon size={14} />} 
                  size="small" 
                  onClick={handleRefresh}
                >
                  새로고침
                </Button>
              }
            >
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>
                  {formatDateTime(refreshTime)}
                </div>
                <div style={{ color: '#666' }}>
                  {formatRelative(refreshTime)}
                </div>
              </div>
            </Card>
          </Col>
        </Row>

        <div style={{ margin: '24px 0' }}>
          <Title level={4}>포맷팅 예제</Title>
          <Table
            columns={tableColumns}
            dataSource={formatExamples}
            pagination={false}
            size="small"
          />
        </div>

        <div style={{ margin: '24px 0' }}>
          <Title level={4}>Ant Design 컴포넌트 테스트</Title>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card title="DatePicker" size="small">
                <DatePicker
                  style={{ width: '100%' }}
                  format={getAntdDateFormat()}
                  placeholder="날짜 선택"
                />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card title="TimePicker" size="small">
                <TimePicker
                  style={{ width: '100%' }}
                  format={getAntdTimeFormat()}
                  placeholder="시간 선택"
                />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card title="RangePicker" size="small">
                <RangePicker
                  style={{ width: '100%' }}
                  format={getAntdDateFormat()}
                  placeholder={['시작일', '종료일']}
                />
              </Card>
            </Col>
          </Row>
        </div>

        <div style={{ marginTop: 24 }}>
          <Title level={4}>다양한 날짜 테스트</Title>
          <Space direction="vertical" style={{ width: '100%' }}>
            {testDates.map((date, index) => (
              <Card key={index} size="small">
                <Row>
                  <Col span={6}>
                    <Text strong>테스트 날짜 {index + 1}:</Text>
                  </Col>
                  <Col span={6}>
                    <Text>{formatDate(date)}</Text>
                  </Col>
                  <Col span={6}>
                    <Text>{formatTime(date)}</Text>
                  </Col>
                  <Col span={6}>
                    <Text type="secondary">{formatCalendar(date)}</Text>
                  </Col>
                </Row>
              </Card>
            ))}
          </Space>
        </div>
      </Card>
    </div>
  );
};