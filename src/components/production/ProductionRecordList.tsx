'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Card,
  Button,
  Space,
  Select,
  DatePicker,
  Modal,
  Form,
  InputNumber,
  Typography,
  Popconfirm,
  Tag,
  Row,
  Col,
  App
} from 'antd';
import {
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useMachines } from '@/hooks/useMachines';
import { useDataInputTranslation } from '@/hooks/useTranslation';

const { Text, Title } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;

interface ProductionRecord {
  record_id: string;
  machine_id: string;
  date: string;
  shift: 'A' | 'B';
  output_qty: number;
  defect_qty: number;
  planned_runtime?: number;
  actual_runtime?: number;
  availability?: number;
  performance?: number;
  quality?: number;
  oee?: number;
  created_at?: string;
  machine?: {
    id: string;
    name: string;
    location: string;
  };
}

interface ProductionRecordListProps {
  title?: string;
}

const ProductionRecordList: React.FC<ProductionRecordListProps> = ({ title }) => {
  const { t } = useDataInputTranslation();
  const { machines, loading: machinesLoading } = useMachines();
  const { message: messageApi } = App.useApp();

  // 상태
  const [records, setRecords] = useState<ProductionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0
  });

  // 필터 상태
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [selectedShift, setSelectedShift] = useState<string | null>(null);

  // 수정 모달 상태
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ProductionRecord | null>(null);
  const [editForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  // 생산 기록 조회
  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      params.append('page', pagination.current.toString());
      params.append('limit', pagination.pageSize.toString());

      if (selectedMachineId) {
        params.append('machine_id', selectedMachineId);
      }
      if (dateRange && dateRange[0] && dateRange[1]) {
        params.append('startDate', dateRange[0].format('YYYY-MM-DD'));
        params.append('endDate', dateRange[1].format('YYYY-MM-DD'));
      }
      if (selectedShift) {
        params.append('shift', selectedShift);
      }

      const response = await fetch(`/api/production-records?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      setRecords(result.records || []);
      setPagination(prev => ({
        ...prev,
        total: result.pagination?.total || 0
      }));
    } catch (error) {
      console.error('Error fetching production records:', error);
      messageApi.error(t('recordList.loadError'));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.current, pagination.pageSize, selectedMachineId, dateRange, selectedShift, messageApi, t]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // 수정 모달 열기
  const openEditModal = (record: ProductionRecord) => {
    setEditingRecord(record);
    editForm.setFieldsValue({
      output_qty: record.output_qty,
      defect_qty: record.defect_qty
    });
    setEditModalVisible(true);
  };

  // 수정 저장
  const handleEditSave = async () => {
    if (!editingRecord) return;

    try {
      const values = await editForm.validateFields();
      setSaving(true);

      // 양품 수량 계산
      const goodQty = Math.max(0, values.output_qty - values.defect_qty);
      const quality = values.output_qty > 0 ? goodQty / values.output_qty : 0;

      const response = await fetch(`/api/production-records/${editingRecord.record_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          output_qty: values.output_qty,
          defect_qty: values.defect_qty,
          quality: Math.round(quality * 10000) / 10000
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        messageApi.success(t('messages.recordUpdateSuccess'));
        setEditModalVisible(false);
        setEditingRecord(null);
        editForm.resetFields();
        fetchRecords();
      } else {
        throw new Error(result.error || 'Update failed');
      }
    } catch (error) {
      console.error('Error updating production record:', error);
      messageApi.error(t('messages.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // 삭제
  const handleDelete = async (recordId: string) => {
    try {
      setLoading(true);

      const response = await fetch(`/api/production-records/${recordId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        messageApi.success(t('messages.recordDeleteSuccess'));
        fetchRecords();
      } else {
        throw new Error(result.error || 'Delete failed');
      }
    } catch (error) {
      console.error('Error deleting production record:', error);
      messageApi.error(t('messages.recordDeleteFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 필터 초기화
  const resetFilters = () => {
    setSelectedMachineId(null);
    setDateRange(null);
    setSelectedShift(null);
    setPagination(prev => ({ ...prev, current: 1 }));
  };

  // 테이블 컬럼
  const columns = [
    {
      title: t('recordList.columns.date'),
      dataIndex: 'date',
      key: 'date',
      width: 120,
      render: (date: string) => dayjs(date).format('YYYY-MM-DD')
    },
    {
      title: t('recordList.columns.machine'),
      dataIndex: 'machine',
      key: 'machine',
      width: 150,
      render: (machine: ProductionRecord['machine']) => (
        <div>
          <div>{machine?.name || '-'}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{machine?.location}</Text>
        </div>
      )
    },
    {
      title: t('recordList.columns.shift'),
      dataIndex: 'shift',
      key: 'shift',
      width: 80,
      render: (shift: string) => (
        <Tag color={shift === 'A' ? 'orange' : 'blue'}>
          {shift === 'A' ? t('shift.dayShift') : t('shift.nightShift')}
        </Tag>
      )
    },
    {
      title: t('recordList.columns.outputQty'),
      dataIndex: 'output_qty',
      key: 'output_qty',
      width: 100,
      align: 'right' as const,
      render: (qty: number) => `${qty?.toLocaleString() || 0} ${t('common.pieces')}`
    },
    {
      title: t('recordList.columns.defectQty'),
      dataIndex: 'defect_qty',
      key: 'defect_qty',
      width: 100,
      align: 'right' as const,
      render: (qty: number) => (
        <Text type={qty > 0 ? 'danger' : undefined}>
          {qty?.toLocaleString() || 0} {t('common.pieces')}
        </Text>
      )
    },
    {
      title: t('recordList.columns.goodQty'),
      key: 'good_qty',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, record: ProductionRecord) => {
        const goodQty = Math.max(0, (record.output_qty || 0) - (record.defect_qty || 0));
        return <Text type="success">{goodQty.toLocaleString()} {t('common.pieces')}</Text>;
      }
    },
    {
      title: t('recordList.columns.oee'),
      dataIndex: 'oee',
      key: 'oee',
      width: 80,
      align: 'right' as const,
      render: (oee: number) => {
        const oeePercent = (oee || 0) * 100;
        let color = 'green';
        if (oeePercent < 60) color = 'red';
        else if (oeePercent < 80) color = 'orange';
        return <Tag color={color}>{oeePercent.toFixed(1)}%</Tag>;
      }
    },
    {
      title: t('recordList.columns.actions'),
      key: 'actions',
      width: 120,
      render: (_: unknown, record: ProductionRecord) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          >
            {t('recordList.edit')}
          </Button>
          <Popconfirm
            title={t('messages.confirmDelete')}
            description={t('messages.confirmDeleteDescription')}
            onConfirm={() => handleDelete(record.record_id)}
            okText={t('recordList.delete')}
            cancelText={t('recordList.editModal.cancel')}
            okButtonProps={{ danger: true }}
          >
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              {t('recordList.delete')}
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      {/* 필터 카드 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} sm={12} md={6}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Text strong>{t('recordList.columns.machine')}</Text>
              <Select
                placeholder={t('recordList.allMachines')}
                allowClear
                loading={machinesLoading}
                value={selectedMachineId}
                onChange={setSelectedMachineId}
                style={{ width: '100%' }}
                showSearch
                optionFilterProp="children"
              >
                {machines.map(machine => (
                  <Option key={machine.id} value={machine.id}>
                    {machine.name}
                  </Option>
                ))}
              </Select>
            </Space>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Text strong>{t('recordList.dateRange')}</Text>
              <RangePicker
                value={dateRange}
                onChange={(dates) => setDateRange(dates)}
                style={{ width: '100%' }}
                format="YYYY-MM-DD"
              />
            </Space>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Text strong>{t('recordList.columns.shift')}</Text>
              <Select
                placeholder={t('recordList.allShifts')}
                allowClear
                value={selectedShift}
                onChange={setSelectedShift}
                style={{ width: '100%' }}
              >
                <Option value="A">{t('shift.dayShift')}</Option>
                <Option value="B">{t('shift.nightShift')}</Option>
              </Select>
            </Space>
          </Col>
          <Col xs={24} sm={12} md={8}>
            <Space style={{ marginTop: 22 }}>
              <Button
                type="primary"
                icon={<SearchOutlined />}
                onClick={() => {
                  setPagination(prev => ({ ...prev, current: 1 }));
                  fetchRecords();
                }}
              >
                {t('recordList.search')}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={resetFilters}>
                {t('recordList.reset')}
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 데이터 테이블 */}
      <Card
        title={
          <Space>
            <Title level={5} style={{ margin: 0 }}>
              {title || t('recordList.pageTitle')}
            </Title>
            <Text type="secondary">
              ({t('recordList.totalRecords', { count: pagination.total })})
            </Text>
          </Space>
        }
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchRecords}
            loading={loading}
          >
            {t('recordList.refresh')}
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={records}
          rowKey="record_id"
          loading={loading}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            showTotal: (total) => t('recordList.totalRecords', { count: total }),
            onChange: (page, pageSize) => {
              setPagination(prev => ({
                ...prev,
                current: page,
                pageSize: pageSize || 20
              }));
            }
          }}
          scroll={{ x: 900 }}
          locale={{ emptyText: t('recordList.noRecords') }}
        />
      </Card>

      {/* 수정 모달 */}
      <Modal
        title={t('recordList.editModal.title')}
        open={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingRecord(null);
          editForm.resetFields();
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setEditModalVisible(false);
              setEditingRecord(null);
              editForm.resetFields();
            }}
          >
            {t('recordList.editModal.cancel')}
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={saving}
            onClick={handleEditSave}
          >
            {t('recordList.editModal.save')}
          </Button>
        ]}
      >
        {editingRecord && (
          <div style={{ marginBottom: 16 }}>
            <Text strong>{t('recordList.editModal.recordInfo')}</Text>
            <div style={{ marginTop: 8, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
              <Row gutter={16}>
                <Col span={12}>
                  <Text type="secondary">{t('recordList.editModal.machine')}: </Text>
                  <Text>{editingRecord.machine?.name || '-'}</Text>
                </Col>
                <Col span={12}>
                  <Text type="secondary">{t('recordList.editModal.date')}: </Text>
                  <Text>{editingRecord.date}</Text>
                </Col>
              </Row>
              <Row gutter={16} style={{ marginTop: 4 }}>
                <Col span={12}>
                  <Text type="secondary">{t('recordList.editModal.shift')}: </Text>
                  <Tag color={editingRecord.shift === 'A' ? 'orange' : 'blue'}>
                    {editingRecord.shift === 'A' ? t('shift.dayShift') : t('shift.nightShift')}
                  </Tag>
                </Col>
                <Col span={12}>
                  <Text type="secondary">{t('recordList.editModal.recordId')}: </Text>
                  <Text code style={{ fontSize: 11 }}>{editingRecord.record_id}</Text>
                </Col>
              </Row>
            </div>
          </div>
        )}
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="output_qty"
            label={t('recordList.editModal.outputQty')}
            rules={[
              { required: true, message: t('recordList.editModal.outputQtyRequired') },
              { type: 'number', min: 0, message: t('recordList.editModal.minZero') }
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              addonAfter={t('common.pieces')}
            />
          </Form.Item>
          <Form.Item
            name="defect_qty"
            label={t('recordList.editModal.defectQty')}
            rules={[
              { required: true, message: t('recordList.editModal.defectQtyRequired') },
              { type: 'number', min: 0, message: t('recordList.editModal.minZero') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (value !== undefined && value > getFieldValue('output_qty')) {
                    return Promise.reject(new Error(t('recordList.editModal.defectExceedsOutput')));
                  }
                  return Promise.resolve();
                }
              })
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              addonAfter={t('common.pieces')}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ProductionRecordList;
