import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  DatePicker,
  Table,
  Tag,
  Space,
  Alert,
  Spin,
  Progress,
  Modal,
  message,
  Tooltip,
  Statistic,
  Row,
  Col
} from 'antd';
import {
  PlayCircleOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs, { Dayjs } from 'dayjs';
import {
  OEEAggregationService,
  AggregationLogEntry,
  OEEAggregationResult,
  getAggregationStatusMessage,
  summarizeAggregationResults
} from '@/utils/oeeAggregation';

const { RangePicker } = DatePicker;

interface OEEAggregationManagerProps {
  className?: string;
}

const OEEAggregationManager: React.FC<OEEAggregationManagerProps> = ({ className }) => {
  const { t } = useTranslation(['admin', 'common']);
  
  // 상태 관리
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<AggregationLogEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs().subtract(1, 'day'));
  const [canTrigger, setCanTrigger] = useState(false);
  const [missingDates, setMissingDates] = useState<string[]>([]);
  const [batchModalVisible, setBatchModalVisible] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    results: OEEAggregationResult[];
  }>({ current: 0, total: 0, results: [] });

  // 권한 확인
  useEffect(() => {
    checkPermissions();
  }, []);

  // 초기 데이터 로드
  useEffect(() => {
    if (canTrigger) {
      loadAggregationLogs();
      findMissingAggregations();
    }
  }, [canTrigger]);

  const checkPermissions = async () => {
    try {
      const hasPermission = await OEEAggregationService.canTriggerAggregation();
      setCanTrigger(hasPermission);
    } catch (error) {
      console.error('Error checking permissions:', error);
      setCanTrigger(false);
    }
  };

  const loadAggregationLogs = async () => {
    try {
      const logData = await OEEAggregationService.getAggregationLogs(20);
      setLogs(logData);
    } catch (error) {
      console.error('Error loading aggregation logs:', error);
      message.error('집계 로그를 불러오는데 실패했습니다.');
    }
  };

  const findMissingAggregations = async () => {
    try {
      const missing = await OEEAggregationService.getMissingAggregationDates(7);
      setMissingDates(missing);
    } catch (error) {
      console.error('Error finding missing aggregations:', error);
    }
  };

  const handleSingleAggregation = async () => {
    if (!selectedDate) return;

    setLoading(true);
    try {
      const dateStr = selectedDate.format('YYYY-MM-DD');
      const result = await OEEAggregationService.triggerDailyAggregation(dateStr);
      
      if (result.success) {
        message.success(`${dateStr} 날짜의 OEE 집계가 완료되었습니다. (${result.processed_records}개 레코드 처리)`);
        loadAggregationLogs();
        findMissingAggregations();
      } else {
        message.error(`집계 실패: ${result.error}`);
      }
    } catch (error) {
      console.error('Error triggering aggregation:', error);
      message.error('집계 실행 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleBatchAggregation = async () => {
    if (missingDates.length === 0) {
      message.info('집계가 필요한 날짜가 없습니다.');
      return;
    }

    setBatchModalVisible(true);
    setBatchProgress({ current: 0, total: missingDates.length, results: [] });

    try {
      const results: OEEAggregationResult[] = [];
      
      for (let i = 0; i < missingDates.length; i++) {
        const date = missingDates[i];
        setBatchProgress(prev => ({ ...prev, current: i + 1 }));
        
        const result = await OEEAggregationService.triggerDailyAggregation(date);
        results.push(result);
        
        setBatchProgress(prev => ({ ...prev, results: [...results] }));
        
        // 각 요청 사이에 잠시 대기
        if (i < missingDates.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const summary = summarizeAggregationResults(results);
      message.success(
        `일괄 집계 완료: ${summary.successfulDates}/${summary.totalDates} 성공, ` +
        `총 ${summary.totalRecordsProcessed}개 레코드 처리`
      );

      loadAggregationLogs();
      findMissingAggregations();
    } catch (error) {
      console.error('Error in batch aggregation:', error);
      message.error('일괄 집계 중 오류가 발생했습니다.');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'started':
        return <ClockCircleOutlined style={{ color: '#1890ff' }} />;
      case 'completed':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'failed':
        return <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />;
      default:
        return null;
    }
  };

  const getStatusTag = (status: string) => {
    const colors = {
      started: 'processing',
      completed: 'success',
      failed: 'error'
    };
    
    const labels = {
      started: '진행중',
      completed: '완료',
      failed: '실패'
    };

    return (
      <Tag color={colors[status as keyof typeof colors]} icon={getStatusIcon(status)}>
        {labels[status as keyof typeof labels] || status}
      </Tag>
    );
  };

  const columns = [
    {
      title: '대상 날짜',
      dataIndex: 'target_date',
      key: 'target_date',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD'),
      sorter: (a: AggregationLogEntry, b: AggregationLogEntry) => 
        dayjs(a.target_date).unix() - dayjs(b.target_date).unix(),
    },
    {
      title: '실행 시간',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (datetime: string) => dayjs(datetime).format('MM-DD HH:mm:ss'),
      sorter: (a: AggregationLogEntry, b: AggregationLogEntry) => 
        dayjs(a.created_at).unix() - dayjs(b.created_at).unix(),
    },
    {
      title: '상태',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => getStatusTag(status),
      filters: [
        { text: '진행중', value: 'started' },
        { text: '완료', value: 'completed' },
        { text: '실패', value: 'failed' },
      ],
      onFilter: (value: any, record: AggregationLogEntry) => record.status === value,
    },
    {
      title: '처리 레코드',
      dataIndex: 'processed_records',
      key: 'processed_records',
      render: (count: number) => count.toLocaleString(),
      sorter: (a: AggregationLogEntry, b: AggregationLogEntry) => 
        a.processed_records - b.processed_records,
    },
    {
      title: '실행 시간',
      dataIndex: 'execution_time_ms',
      key: 'execution_time_ms',
      render: (time: number | null) => 
        time ? `${(time / 1000).toFixed(1)}초` : '-',
    },
    {
      title: '오류 메시지',
      dataIndex: 'error_message',
      key: 'error_message',
      render: (error: string | null) => 
        error ? (
          <Tooltip title={error}>
            <span style={{ color: '#ff4d4f', cursor: 'pointer' }}>
              오류 확인
            </span>
          </Tooltip>
        ) : '-',
    },
  ];

  if (!canTrigger) {
    return (
      <Card className={className}>
        <Alert
          message="접근 권한 없음"
          description="OEE 집계 관리는 관리자만 접근할 수 있습니다."
          type="warning"
          showIcon
        />
      </Card>
    );
  }

  return (
    <div className={className}>
      <Row gutter={[16, 16]}>
        {/* 통계 카드 */}
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="집계 필요 날짜"
              value={missingDates.length}
              valueStyle={{ color: missingDates.length > 0 ? '#cf1322' : '#3f8600' }}
              prefix={<HistoryOutlined />}
            />
          </Card>
        </Col>
        
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="최근 성공 집계"
              value={logs.filter(log => log.status === 'completed').length}
              valueStyle={{ color: '#3f8600' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="최근 실패 집계"
              value={logs.filter(log => log.status === 'failed').length}
              valueStyle={{ color: '#cf1322' }}
              prefix={<ExclamationCircleOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="총 처리 레코드"
              value={logs.reduce((sum, log) => sum + log.processed_records, 0)}
              prefix={<PlayCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* 집계 실행 섹션 */}
      <Card title="OEE 집계 실행" style={{ marginTop: 16 }}>
        {missingDates.length > 0 && (
          <Alert
            message={`집계가 필요한 날짜: ${missingDates.join(', ')}`}
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            action={
              <Button
                size="small"
                type="primary"
                onClick={handleBatchAggregation}
                icon={<PlayCircleOutlined />}
              >
                일괄 집계
              </Button>
            }
          />
        )}

        <Space size="middle" wrap>
          <DatePicker
            value={selectedDate}
            onChange={setSelectedDate}
            format="YYYY-MM-DD"
            placeholder="집계할 날짜 선택"
            disabledDate={(current) => current && current > dayjs().endOf('day')}
          />
          
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={loading}
            onClick={handleSingleAggregation}
            disabled={!selectedDate}
          >
            단일 집계 실행
          </Button>

          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              loadAggregationLogs();
              findMissingAggregations();
            }}
          >
            새로고침
          </Button>
        </Space>
      </Card>

      {/* 집계 로그 테이블 */}
      <Card title="집계 실행 로그" style={{ marginTop: 16 }}>
        <Table
          columns={columns}
          dataSource={logs}
          rowKey="id"
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => 
              `${range[0]}-${range[1]} / 총 ${total}개`,
          }}
          scroll={{ x: 800 }}
        />
      </Card>

      {/* 일괄 집계 진행 모달 */}
      <Modal
        title="일괄 OEE 집계 진행 상황"
        open={batchModalVisible}
        onCancel={() => setBatchModalVisible(false)}
        footer={
          batchProgress.current === batchProgress.total ? [
            <Button key="close" onClick={() => setBatchModalVisible(false)}>
              닫기
            </Button>
          ] : null
        }
        closable={batchProgress.current === batchProgress.total}
        maskClosable={false}
      >
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Progress
            type="circle"
            percent={batchProgress.total > 0 ? 
              Math.round((batchProgress.current / batchProgress.total) * 100) : 0}
            format={() => `${batchProgress.current}/${batchProgress.total}`}
          />
          
          <div style={{ marginTop: 16 }}>
            {batchProgress.current < batchProgress.total ? (
              <Spin>
                <div style={{ padding: 20 }}>
                  집계 진행 중... ({batchProgress.current}/{batchProgress.total})
                </div>
              </Spin>
            ) : (
              <div>
                <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 24 }} />
                <div style={{ marginTop: 8 }}>일괄 집계가 완료되었습니다!</div>
              </div>
            )}
          </div>

          {batchProgress.results.length > 0 && (
            <div style={{ marginTop: 16, textAlign: 'left' }}>
              <h4>집계 결과:</h4>
              {batchProgress.results.map((result, index) => (
                <div key={index} style={{ marginBottom: 4 }}>
                  {result.date}: {result.success ? 
                    <Tag color="success">성공 ({result.processed_records}개)</Tag> :
                    <Tag color="error">실패</Tag>
                  }
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default OEEAggregationManager;