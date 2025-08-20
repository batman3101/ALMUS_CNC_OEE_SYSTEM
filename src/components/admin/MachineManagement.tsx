'use client';

import React, { useState, useEffect } from 'react';
import { 
  Table, 
  Button, 
  Space, 
  Input, 
  Switch, 
  Tag, 
  Popconfirm, 
  Card,
  Row,
  Col,
  App,
  Modal
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
import { useTranslation } from '@/hooks/useTranslation';
import { useAdminOperations } from '@/hooks/useAdminOperations';
import type { Machine } from '@/types';
import MachineForm from './MachineForm';
import { MachinesBulkUpload } from '@/components/machines';

const { Search } = Input;

const MachineManagement: React.FC = () => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { loading, fetchMachines, deleteMachine, updateMachine } = useAdminOperations();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [searchText, setSearchText] = useState('');
  const [formVisible, setFormVisible] = useState(false);
  const [bulkUploadVisible, setBulkUploadVisible] = useState(false);
  const [editingMachine, setEditingMachine] = useState<Machine | null>(null);

  const loadMachines = async () => {
    try {
      const data = await fetchMachines();
      setMachines(data);
    } catch (error) {
      console.error('Error fetching machines:', error);
      message.error('오류가 발생했습니다');
    }
  };

  useEffect(() => {
    loadMachines();
  }, []);

  const handleDelete = async (machineId: string) => {
    try {
      await deleteMachine(machineId);
      message.success('설비가 성공적으로 삭제되었습니다');
      loadMachines();
    } catch (error) {
      console.error('Error deleting machine:', error);
      message.error('설비 삭제 중 오류가 발생했습니다');
    }
  };

  const handleStatusToggle = async (machine: Machine) => {
    try {
      await updateMachine(machine.id, { 
        is_active: !machine.is_active
      });
      message.success('설비 정보가 성공적으로 저장되었습니다');
      loadMachines();
    } catch (error) {
      console.error('Error updating machine status:', error);
      message.error('설비 정보 저장 중 오류가 발생했습니다');
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

  const filteredMachines = machines.filter(machine =>
    machine.name.toLowerCase().includes(searchText.toLowerCase()) ||
    machine.location.toLowerCase().includes(searchText.toLowerCase()) ||
    (machine.model_type && machine.model_type.toLowerCase().includes(searchText.toLowerCase())) ||
    (machine.processing_step && machine.processing_step.toLowerCase().includes(searchText.toLowerCase()))
  );

  const columns: ColumnsType<Machine> = [
    {
      title: '설비명',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: '위치',
      dataIndex: 'location',
      key: 'location',
      sorter: (a, b) => a.location.localeCompare(b.location),
    },
    {
      title: '모델 타입',
      dataIndex: 'model_type',
      key: 'model_type',
      render: (text) => text || '-',
    },
    {
      title: '가공 공정',
      dataIndex: 'processing_step',
      key: 'processing_step',
      render: (text) => text || '-',
      sorter: (a, b) => (a.processing_step || '').localeCompare(b.processing_step || ''),
    },
    {
      title: 'Tact Time (초)',
      dataIndex: 'default_tact_time',
      key: 'default_tact_time',
      sorter: (a, b) => a.default_tact_time - b.default_tact_time,
      render: (value) => value.toLocaleString(),
    },
    {
      title: '상태',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (isActive: boolean, record) => (
        <Switch
          checked={isActive}
          onChange={() => handleStatusToggle(record)}
          checkedChildren="활성"
          unCheckedChildren="비활성"
        />
      ),
    },
    {
      title: '생성일',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date) => new Date(date).toLocaleDateString(),
      sorter: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    },
    {
      title: '작업',
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            편집
          </Button>
          <Popconfirm
            title="이 설비를 삭제하시겠습니까?"
            onConfirm={() => handleDelete(record.id)}
            okText="확인"
            cancelText="취소"
          >
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
            >
              삭제
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
            <h2 style={{ margin: 0 }}>설비 관리</h2>
          </Col>
          <Col>
            <Space>
              <Search
                placeholder="검색"
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
                새로고침
              </Button>
              <Button
                icon={<UploadOutlined />}
                onClick={() => setBulkUploadVisible(true)}
              >
                일괄 등록
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleAdd}
              >
                설비 추가
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
              `${range[0]}-${range[1]} / ${total}개 항목`,
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