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
import dayjs, { Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import {
  OEEAggregationService,
  AggregationLogEntry,
  OEEAggregationResult,
  summarizeAggregationResults
} from '@/utils/oeeAggregation';
import { useAdminTranslation } from '@/hooks/useTranslation';

interface OEEAggregationManagerProps {
  className?: string;
}

const OEEAggregationManager: React.FC<OEEAggregationManagerProps> = ({ className }) => {
  const { t } = useAdminTranslation();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 초기 데이터 로드
  useEffect(() => {
    if (canTrigger) {
      loadAggregationLogs();
      findMissingAggregations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      message.error(t('aggregation.messages.loadLogsFailed'));
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
        message.success(t('aggregation.messages.singleDone', { date: dateStr, count: result.processed_records }));
        loadAggregationLogs();
        findMissingAggregations();
      } else {
        message.error(t('aggregation.messages.singleFailed', { error: result.error }));
      }
    } catch (error) {
      console.error('Error triggering aggregation:', error);
      message.error(t('aggregation.messages.executionError'));
    } finally {
      setLoading(false);
    }
  };

  const handleBatchAggregation = async () => {
    if (missingDates.length === 0) {
      message.info(t('aggregation.messages.noMissingDates'));
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
        t('aggregation.messages.batchDone', {
          successful: summary.successfulDates,
          total: summary.totalDates,
          recordsProcessed: summary.totalRecordsProcessed
        })
      );

      loadAggregationLogs();
      findMissingAggregations();
    } catch (error) {
      console.error('Error in batch aggregation:', error);
      message.error(t('aggregation.messages.batchError'));
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
      started: t('aggregation.status.started'),
      completed: t('aggregation.status.completed'),
      failed: t('aggregation.status.failed')
    };

    return (
      <Tag color={colors[status as keyof typeof colors]} icon={getStatusIcon(status)}>
        {labels[status as keyof typeof labels] || status}
      </Tag>
    );
  };

  const columns: ColumnsType<AggregationLogEntry> = [
    {
      title: t('aggregation.columns.targetDate'),
      dataIndex: 'target_date',
      key: 'target_date',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD'),
      sorter: (a: AggregationLogEntry, b: AggregationLogEntry) =>
        dayjs(a.target_date).unix() - dayjs(b.target_date).unix(),
    },
    {
      title: t('aggregation.columns.executedAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (datetime: string) => dayjs(datetime).format('MM-DD HH:mm:ss'),
      sorter: (a: AggregationLogEntry, b: AggregationLogEntry) =>
        dayjs(a.created_at).unix() - dayjs(b.created_at).unix(),
    },
    {
      title: t('aggregation.columns.status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => getStatusTag(status),
      filters: [
        { text: t('aggregation.status.started'), value: 'started' },
        { text: t('aggregation.status.completed'), value: 'completed' },
        { text: t('aggregation.status.failed'), value: 'failed' },
      ],
      onFilter: (value: React.Key | boolean, record: AggregationLogEntry) => record.status === value,
    },
    {
      title: t('aggregation.columns.processedRecords'),
      dataIndex: 'processed_records',
      key: 'processed_records',
      render: (count: number) => count.toLocaleString(),
      sorter: (a: AggregationLogEntry, b: AggregationLogEntry) =>
        a.processed_records - b.processed_records,
    },
    {
      title: t('aggregation.columns.executionTime'),
      dataIndex: 'execution_time_ms',
      key: 'execution_time_ms',
      render: (time: number | null) =>
        time ? t('modelInfo:단위.초값', { n: (time / 1000).toFixed(1) }) : '-',
    },
    {
      title: t('aggregation.columns.errorMessage'),
      dataIndex: 'error_message',
      key: 'error_message',
      render: (error: string | null) =>
        error ? (
          <Tooltip title={error}>
            <span style={{ color: '#ff4d4f', cursor: 'pointer' }}>
              {t('aggregation.columns.checkError')}
            </span>
          </Tooltip>
        ) : '-',
    },
  ];

  if (!canTrigger) {
    return (
      <Card className={className}>
        <Alert
          message={t('aggregation.noPermission.title')}
          description={t('aggregation.noPermission.description')}
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
              title={t('aggregation.stats.missingDates')}
              value={missingDates.length}
              valueStyle={{ color: missingDates.length > 0 ? '#cf1322' : '#3f8600' }}
              prefix={<HistoryOutlined />}
            />
          </Card>
        </Col>
        
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title={t('aggregation.stats.recentSuccess')}
              value={logs.filter(log => log.status === 'completed').length}
              valueStyle={{ color: '#3f8600' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title={t('aggregation.stats.recentFailed')}
              value={logs.filter(log => log.status === 'failed').length}
              valueStyle={{ color: '#cf1322' }}
              prefix={<ExclamationCircleOutlined />}
            />
          </Card>
        </Col>

        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title={t('aggregation.stats.totalProcessed')}
              value={logs.reduce((sum, log) => sum + log.processed_records, 0)}
              prefix={<PlayCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* 집계 실행 섹션 */}
      <Card title={t('aggregation.cards.executionTitle')} style={{ marginTop: 16 }}>
        {missingDates.length > 0 && (
          <Alert
            message={t('aggregation.alerts.missingDatesMessage', { dates: missingDates.join(', ') })}
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
                {t('aggregation.buttons.batchAggregation')}
              </Button>
            }
          />
        )}

        <Space size="middle" wrap>
          <DatePicker
            value={selectedDate}
            onChange={setSelectedDate}
            format="YYYY-MM-DD"
            placeholder={t('aggregation.placeholders.selectDate')}
            disabledDate={(current) => current && current > dayjs().endOf('day')}
          />

          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={loading}
            onClick={handleSingleAggregation}
            disabled={!selectedDate}
          >
            {t('aggregation.buttons.singleAggregation')}
          </Button>

          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              loadAggregationLogs();
              findMissingAggregations();
            }}
          >
            {t('table.refresh')}
          </Button>
        </Space>
      </Card>

      {/* 집계 로그 테이블 */}
      <Card title={t('aggregation.cards.logsTitle')} style={{ marginTop: 16 }}>
        <Table
          columns={columns}
          dataSource={logs}
          rowKey="id"
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) =>
              t('aggregation.table.showTotal', { start: range[0], end: range[1], total }),
          }}
          scroll={{ x: 800 }}
        />
      </Card>

      {/* 일괄 집계 진행 모달 */}
      <Modal
        title={t('aggregation.modal.batchTitle')}
        open={batchModalVisible}
        onCancel={() => setBatchModalVisible(false)}
        footer={
          batchProgress.current === batchProgress.total ? [
            <Button key="close" onClick={() => setBatchModalVisible(false)}>
              {t('aggregation.buttons.close')}
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
                  {t('aggregation.messages.inProgress', { current: batchProgress.current, total: batchProgress.total })}
                </div>
              </Spin>
            ) : (
              <div>
                <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 24 }} />
                <div style={{ marginTop: 8 }}>{t('aggregation.messages.batchCompleted')}</div>
              </div>
            )}
          </div>

          {batchProgress.results.length > 0 && (
            <div style={{ marginTop: 16, textAlign: 'left' }}>
              <h4>{t('aggregation.messages.resultsHeading')}</h4>
              {batchProgress.results.map((result, index) => (
                <div key={index} style={{ marginBottom: 4 }}>
                  {result.date}: {result.success ?
                    <Tag color="success">{t('aggregation.messages.successCount', { count: result.processed_records })}</Tag> :
                    <Tag color="error">{t('aggregation.status.failed')}</Tag>
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