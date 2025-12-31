'use client';

import React, { useState, useEffect } from 'react';
import { 
  Table, 
  Card, 
  Typography, 
  Tag, 
  Space, 
  Button, 
  DatePicker, 
  Select,
  Input,
  message,
  Tooltip,
  Modal
} from 'antd';
import {
  ReloadOutlined,
  SearchOutlined,
  EyeOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useLanguage } from '@/contexts/LanguageContext';
import { systemSettingsService } from '@/lib/systemSettings';
import type { SystemSettingAudit } from '@/types/systemSettings';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;
const { Option } = Select;

const SettingsAuditTab: React.FC = () => {
  const { t } = useLanguage();
  const [auditData, setAuditData] = useState<SystemSettingAudit[]>([]);
  const [loading, setLoading] = useState(false);
  const [filteredData, setFilteredData] = useState<SystemSettingAudit[]>([]);
  const [filters, setFilters] = useState({
    category: '',
    setting_key: '',
    changed_by: '',
    dateRange: null as [dayjs.Dayjs, dayjs.Dayjs] | null
  });
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<SystemSettingAudit | null>(null);

  // 감사 로그 데이터 로드
  const loadAuditData = async () => {
    try {
      setLoading(true);
      const response = await systemSettingsService.getSettingsAudit(100);
      
      if (response.success && response.data) {
        setAuditData(response.data);
        setFilteredData(response.data);
      } else {
        message.error(response.error || t('settings.audit.loadError'));
      }
    } catch (error) {
      console.error('Error loading audit data:', error);
      message.error(t('settings.audit.loadError'));
    } finally {
      setLoading(false);
    }
  };

  // 초기 데이터 로드
  useEffect(() => {
    loadAuditData();
  }, []);

  // 필터 적용
  useEffect(() => {
    let filtered = [...auditData];

    // 카테고리 필터
    if (filters.category) {
      filtered = filtered.filter(item => item.category === filters.category);
    }

    // 설정 키 필터
    if (filters.setting_key) {
      filtered = filtered.filter(item => 
        item.setting_key.toLowerCase().includes(filters.setting_key.toLowerCase())
      );
    }

    // 변경자 필터
    if (filters.changed_by) {
      filtered = filtered.filter(item => 
        item.changed_by?.toLowerCase().includes(filters.changed_by.toLowerCase())
      );
    }

    // 날짜 범위 필터
    if (filters.dateRange) {
      const [start, end] = filters.dateRange;
      filtered = filtered.filter(item => {
        const changeDate = dayjs(item.changed_at);
        return changeDate.isAfter(start.startOf('day')) && changeDate.isBefore(end.endOf('day'));
      });
    }

    setFilteredData(filtered);
  }, [filters, auditData]);

  // 필터 초기화
  const resetFilters = () => {
    setFilters({
      category: '',
      setting_key: '',
      changed_by: '',
      dateRange: null
    });
  };

  // 상세 정보 모달 열기
  const showDetailModal = (record: SystemSettingAudit) => {
    setSelectedRecord(record);
    setDetailModalVisible(true);
  };

  // 값 포맷팅
  const formatValue = (value: unknown) => {
    if (value === null || value === undefined) {
      return <Text type="secondary">null</Text>;
    }
    
    if (typeof value === 'boolean') {
      return <Tag color={value ? 'green' : 'red'}>{value.toString()}</Tag>;
    }
    
    if (typeof value === 'object') {
      return <Text code>{JSON.stringify(value, null, 2)}</Text>;
    }
    
    return <Text>{value.toString()}</Text>;
  };

  // 테이블 컬럼 정의
  const columns: ColumnsType<SystemSettingAudit> = [
    {
      title: t('settings.audit.changeTime'),
      dataIndex: 'changed_at',
      key: 'changed_at',
      width: 180,
      render: (value: string) => (
        <Tooltip title={dayjs(value).format('YYYY-MM-DD HH:mm:ss')}>
          <Text>{dayjs(value).format('MM-DD HH:mm')}</Text>
        </Tooltip>
      ),
      sorter: (a, b) => dayjs(a.changed_at).unix() - dayjs(b.changed_at).unix(),
      defaultSortOrder: 'descend'
    },
    {
      title: t('settings.audit.category'),
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (category: string) => {
        const colors = {
          general: 'blue',
          oee: 'green',
          shift: 'orange',
          notification: 'purple',
          display: 'cyan'
        };
        return <Tag color={colors[category as keyof typeof colors] || 'default'}>{category}</Tag>;
      },
      filters: [
        { text: 'General', value: 'general' },
        { text: 'OEE', value: 'oee' },
        { text: 'Shift', value: 'shift' },
        { text: 'Notification', value: 'notification' },
        { text: 'Display', value: 'display' }
      ],
      onFilter: (value, record) => record.category === value
    },
    {
      title: t('settings.audit.settingKey'),
      dataIndex: 'setting_key',
      key: 'setting_key',
      width: 200,
      render: (key: string) => <Text code>{key}</Text>
    },
    {
      title: t('settings.audit.oldValue'),
      dataIndex: 'old_value',
      key: 'old_value',
      width: 150,
      render: (value: unknown) => (
        <div style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {formatValue(value)}
        </div>
      )
    },
    {
      title: t('settings.audit.newValue'),
      dataIndex: 'new_value',
      key: 'new_value',
      width: 150,
      render: (value: unknown) => (
        <div style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {formatValue(value)}
        </div>
      )
    },
    {
      title: t('settings.audit.changedBy'),
      dataIndex: 'changed_by_name',
      key: 'changed_by_name',
      width: 120,
      render: (name: string) => name || <Text type="secondary">System</Text>
    },
    {
      title: t('settings.audit.reason'),
      dataIndex: 'change_reason',
      key: 'change_reason',
      width: 200,
      render: (reason: string) => (
        <Tooltip title={reason}>
          <Text ellipsis style={{ maxWidth: '200px' }}>
            {reason || <Text type="secondary">-</Text>}
          </Text>
        </Tooltip>
      )
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Button
          type="link"
          icon={<EyeOutlined />}
          onClick={() => showDetailModal(record)}
          size="small"
        >
          {t('common.detail')}
        </Button>
      )
    }
  ];

  // 고유 카테고리 목록
  const uniqueCategories = [...new Set(auditData.map(item => item.category))];

  return (
    <div>
      <Title level={4} style={{ marginBottom: '24px' }}>
        {t('settings.audit.title')}
      </Title>

      {/* 필터 영역 */}
      <Card size="small" style={{ marginBottom: '16px' }}>
        <Space wrap>
          <Select
            placeholder={t('settings.audit.filterCategory')}
            style={{ width: 120 }}
            value={filters.category || undefined}
            onChange={(value) => setFilters(prev => ({ ...prev, category: value || '' }))}
            allowClear
          >
            {uniqueCategories.map(category => (
              <Option key={category} value={category}>{category}</Option>
            ))}
          </Select>

          <Input
            placeholder={t('settings.audit.filterSettingKey')}
            style={{ width: 200 }}
            value={filters.setting_key}
            onChange={(e) => setFilters(prev => ({ ...prev, setting_key: e.target.value }))}
            prefix={<SearchOutlined />}
            allowClear
          />

          <Input
            placeholder={t('settings.audit.filterChangedBy')}
            style={{ width: 150 }}
            value={filters.changed_by}
            onChange={(e) => setFilters(prev => ({ ...prev, changed_by: e.target.value }))}
            prefix={<SearchOutlined />}
            allowClear
          />

          <RangePicker
            value={filters.dateRange}
            onChange={(dates) => setFilters(prev => ({ ...prev, dateRange: dates }))}
            format="YYYY-MM-DD"
            placeholder={[t('common.startDate'), t('common.endDate')]}
          />

          <Button
            icon={<FilterOutlined />}
            onClick={resetFilters}
          >
            {t('common.reset')}
          </Button>

          <Button
            icon={<ReloadOutlined />}
            onClick={loadAuditData}
            loading={loading}
          >
            {t('common.refresh')}
          </Button>
        </Space>
      </Card>

      {/* 감사 로그 테이블 */}
      <Card>
        <Table
          columns={columns}
          dataSource={filteredData}
          rowKey="id"
          loading={loading}
          pagination={{
            total: filteredData.length,
            pageSize: 20,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => 
              `${range[0]}-${range[1]} of ${total} ${t('settings.audit.items')}`
          }}
          scroll={{ x: 1200 }}
          size="small"
        />
      </Card>

      {/* 상세 정보 모달 */}
      <Modal
        title={t('settings.audit.detailTitle')}
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDetailModalVisible(false)}>
            {t('common.close')}
          </Button>
        ]}
        width={800}
      >
        {selectedRecord && (
          <div>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <Text strong>{t('settings.audit.changeTime')}: </Text>
                <Text>{dayjs(selectedRecord.changed_at).format('YYYY-MM-DD HH:mm:ss')}</Text>
              </div>

              <div>
                <Text strong>{t('settings.audit.category')}: </Text>
                <Tag color="blue">{selectedRecord.category}</Tag>
              </div>

              <div>
                <Text strong>{t('settings.audit.settingKey')}: </Text>
                <Text code>{selectedRecord.setting_key}</Text>
              </div>

              <div>
                <Text strong>{t('settings.audit.changedBy')}: </Text>
                <Text>{selectedRecord.changed_by_name || 'System'}</Text>
              </div>

              {selectedRecord.change_reason && (
                <div>
                  <Text strong>{t('settings.audit.reason')}: </Text>
                  <Text>{selectedRecord.change_reason}</Text>
                </div>
              )}

              <div>
                <Text strong>{t('settings.audit.oldValue')}: </Text>
                <div style={{ 
                  marginTop: '8px', 
                  padding: '12px', 
                  backgroundColor: '#fff2f0', 
                  border: '1px solid #ffccc7',
                  borderRadius: '6px' 
                }}>
                  <pre style={{ margin: 0, fontSize: '12px' }}>
                    {selectedRecord.old_value 
                      ? JSON.stringify(selectedRecord.old_value, null, 2)
                      : 'null'
                    }
                  </pre>
                </div>
              </div>

              <div>
                <Text strong>{t('settings.audit.newValue')}: </Text>
                <div style={{ 
                  marginTop: '8px', 
                  padding: '12px', 
                  backgroundColor: '#f6ffed', 
                  border: '1px solid #b7eb8f',
                  borderRadius: '6px' 
                }}>
                  <pre style={{ margin: 0, fontSize: '12px' }}>
                    {JSON.stringify(selectedRecord.new_value, null, 2)}
                  </pre>
                </div>
              </div>
            </Space>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default SettingsAuditTab;