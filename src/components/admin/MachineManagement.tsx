'use client';

import React, { useState, useEffect } from 'react';
import {
  Table,
  Button,
  Space,
  Input,
  Switch,
  Popconfirm,
  Card,
  Row,
  Col,
  App,
  Modal,
  Select
} from 'antd';
import { 
  PlusOutlined, 
  EditOutlined, 
  DeleteOutlined, 
  SearchOutlined,
  ReloadOutlined,
  UploadOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useAdminTranslation } from '@/hooks/useTranslation';
import { useAdminOperations } from '@/hooks/useAdminOperations';
import type { Machine } from '@/types';
import MachineForm from './MachineForm';
import MachinesBulkUpload from '@/components/machines/MachinesBulkUpload';

const { Search } = Input;

const MachineManagement: React.FC = () => {
  const { t } = useAdminTranslation();
  const { message } = App.useApp();
  const { loading, fetchMachines, deleteMachine, updateMachine } = useAdminOperations();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [formVisible, setFormVisible] = useState(false);
  const [bulkUploadVisible, setBulkUploadVisible] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);

  const loadMachines = async () => {
    try {
      const data = await fetchMachines();
      setMachines(data);
    } catch (error) {
      console.error('Error fetching machines:', error);
      message.error(t('machineManagement.saveError'));
    }
  };

  useEffect(() => {
    loadMachines();
  }, []);

  const handleDelete = async (machineId: string) => {
    try {
      await deleteMachine(machineId);
      message.success(t('machineManagement.deleteSuccess'));
      loadMachines();
    } catch (error) {
      console.error('Error deleting machine:', error);
      message.error(t('machineManagement.deleteError'));
    }
  };

  const handleStatusToggle = async (machine: Machine) => {
    try {
      await updateMachine(machine.id, { 
        is_active: !machine.is_active
      });
      message.success(t('machineManagement.saveSuccess'));
      loadMachines();
    } catch (error) {
      console.error('Error updating machine status:', error);
      message.error(t('machineManagement.saveError'));
    }
  };

  const handleEdit = (machine: Machine) => {
    setEditingMachine(machine);
    setFormVisible(true);
  };

  const handleAdd = () => {
    setEditingMachine(null);
    setFormVisible(true);
  };

  const handleFormSuccess = () => {
    setFormVisible(false);
    setEditingMachine(null);
    loadMachines();
  };

  const handleFormCancel = () => {
    setFormVisible(false);
    setEditingMachine(null);
  };

  const filteredMachines = machines.filter(machine => {
    // 텍스트 검색 필터
    const matchesSearch = machine.name.toLowerCase().includes(searchText.toLowerCase()) ||
      machine.location.toLowerCase().includes(searchText.toLowerCase()) ||
      (machine.model_type && machine.model_type.toLowerCase().includes(searchText.toLowerCase())) ||
      (machine.processing_step && machine.processing_step.toLowerCase().includes(searchText.toLowerCase()));
    
    // 상태 필터
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'active' && machine.is_active) ||
      (statusFilter === 'inactive' && !machine.is_active);
    
    return matchesSearch && matchesStatus;
  });

  const columns: ColumnsType<Machine> = [
    {
      title: t('table.columns.machineName'),
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: t('table.columns.location'),
      dataIndex: 'location',
      key: 'location',
      sorter: (a, b) => a.location.localeCompare(b.location),
    },
    {
      title: t('table.columns.machineType'),
      dataIndex: 'equipment_type',
      key: 'equipment_type',
      render: (text) => text || '-',
    },
    {
      title: t('table.columns.productionModel'),
      dataIndex: 'production_model_name',
      key: 'production_model_name',
      render: (text, record) => text ? `${text} - ${record.production_model_description || ''}` : '-',
      sorter: (a, b) => (a.production_model_name || '').localeCompare(b.production_model_name || ''),
    },
    {
      title: t('table.columns.processes'),
      dataIndex: 'current_process_name',
      key: 'current_process_name',
      render: (text) => text || '-',
      sorter: (a, b) => (a.current_process_name || '').localeCompare(b.current_process_name || ''),
    },
    {
      title: t('table.columns.tactTime'),
      dataIndex: 'current_tact_time',
      key: 'current_tact_time',
      sorter: (a, b) => (a.current_tact_time || 0) - (b.current_tact_time || 0),
      render: (value) => value ? value.toLocaleString() : '-',
    },
    {
      title: t('common.status'),
      dataIndex: 'is_active',
      key: 'is_active',
      render: (isActive: boolean, record) => (
        <Switch
          checked={isActive}
          onChange={() => handleStatusToggle(record)}
          checkedChildren={t('common.active')}
          unCheckedChildren={t('common.inactive')}
        />
      ),
    },
    {
      title: t('table.columns.createdDate'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date) => new Date(date).toLocaleDateString(),
      sorter: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    },
    {
      title: t('table.columns.actions'),
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            {t('table.actions.edit')}
          </Button>
          <Popconfirm
            title={t('machineManagement.confirmDelete')}
            onConfirm={() => handleDelete(record.id)}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
          >
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
            >
              {t('table.actions.delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card>
        <Row gutter={[16, 16]} align="middle" justify="space-between">
          <Col>
            <h2 style={{ margin: 0 }}>{t('machineManagement.title')}</h2>
          </Col>
          <Col>
            <Space>
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                style={{ width: 120 }}
                options={[
                  { label: t('common.all'), value: 'all' },
                  { label: t('common.active'), value: 'active' },
                  { label: t('common.inactive'), value: 'inactive' }
                ]}
              />
              <Search
                placeholder={t('table.search')}
                allowClear
                style={{ width: 250 }}
                onChange={(e) => setSearchText(e.target.value)}
                prefix={<SearchOutlined />}
              />
              <Button
                icon={<ReloadOutlined />}
                onClick={loadMachines}
                loading={loading}
              >
                {t('table.refresh')}
              </Button>
              <Button
                icon={<UploadOutlined />}
                onClick={() => setBulkUploadVisible(true)}
              >
                {t('table.bulkUpload')}
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleAdd}
              >
                {t('table.addMachine').substring(2)}
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <Table
          columns={columns}
          dataSource={filteredMachines}
          rowKey="id"
          loading={loading}
          pagination={{
            total: filteredMachines.length,
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => 
              t('table.pagination.showTotal', { start: range[0], end: range[1], total }),
          }}
          scroll={{ x: 1000 }}
        />
      </Card>

      {/* 일괄 업로드 모달 */}
      <Modal
        title="설비 일괄 등록"
        open={bulkUploadVisible}
        onCancel={() => setBulkUploadVisible(false)}
        footer={null}
        width={1200}
        style={{ top: 20 }}
      >
        <MachinesBulkUpload />
      </Modal>

      <MachineForm
        visible={formVisible}
        onCancel={handleFormCancel}
        onSuccess={handleFormSuccess}
        machine={editingMachine}
      />
    </div>
  );
};

export default MachineManagement;