'use client';

import React, { useState, useEffect } from 'react';
import { 
  Table, 
  Button, 
  Space, 
  Input, 
  Tag, 
  Popconfirm, 
  Card,
  Row,
  Col,
  App
} from 'antd';
import { 
  PlusOutlined, 
  EditOutlined, 
  DeleteOutlined, 
  SearchOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useAdminTranslation } from '@/hooks/useTranslation';
import { useAdminOperations } from '@/hooks/useAdminOperations';
import type { User } from '@/types';
import UserForm from './UserForm';

const { Search } = Input;

interface UserWithProfile extends User {
  email: string;
}

const UserManagement: React.FC = () => {
  const { t } = useAdminTranslation();
  const { message } = App.useApp();
  const { loading, fetchUsers, deleteUser } = useAdminOperations();
  const [users, setUsers] = useState<UserWithProfile[]>([]);
  const [searchText, setSearchText] = useState('');
  const [formVisible, setFormVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithProfile | null>(null);

  const loadUsers = async () => {
    try {
      const usersData = await fetchUsers();
      setUsers(usersData);
    } catch (error) {
      console.error('Error fetching users:', error);
      message.error(t('userManagement.saveError'));
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleDelete = async (userId: string) => {
    try {
      await deleteUser(userId);
      message.success(t('userManagement.deleteSuccess'));
      loadUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
      message.error(t('userManagement.deleteError'));
    }
  };

  const handleEdit = (user: UserWithProfile) => {
    setEditingUser(user);
    setFormVisible(true);
  };

  const handleAdd = () => {
    setEditingUser(null);
    setFormVisible(true);
  };

  const handleFormSuccess = () => {
    setFormVisible(false);
    setEditingUser(null);
    loadUsers();
  };

  const handleFormCancel = () => {
    setFormVisible(false);
    setEditingUser(null);
  };

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchText.toLowerCase()) ||
    user.email.toLowerCase().includes(searchText.toLowerCase()) ||
    user.role.toLowerCase().includes(searchText.toLowerCase())
  );

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'red';
      case 'engineer': return 'blue';
      case 'operator': return 'green';
      default: return 'default';
    }
  };

  const columns: ColumnsType<UserWithProfile> = [
    {
      title: t('table.columns.userName'),
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: t('table.columns.email'),
      dataIndex: 'email',
      key: 'email',
      sorter: (a, b) => a.email.localeCompare(b.email),
    },
    {
      title: t('table.columns.role'),
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        const roleLabels = {
          admin: t('roles.admin'),
          engineer: t('roles.operator'),
          operator: t('roles.operator')
        };
        return (
          <Tag color={getRoleColor(role)}>
            {roleLabels[role as keyof typeof roleLabels]}
          </Tag>
        );
      },
      filters: [
        { text: t('roles.admin'), value: 'admin' },
        { text: t('roles.operator'), value: 'engineer' },
        { text: t('roles.operator'), value: 'operator' },
      ],
      onFilter: (value, record) => record.role === value,
    },
    {
      title: t('table.columns.assignedMachines'),
      dataIndex: 'assigned_machines',
      key: 'assigned_machines',
      render: (machines: string[] | null) => {
        if (!machines || machines.length === 0) {
          return <span style={{ color: '#999' }}>-</span>;
        }
        return (
          <span>
            {machines.length}{t('common.assignedMachinesCount')}
          </span>
        );
      },
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
            title={t('userManagement.confirmDelete')}
            onConfirm={() => handleDelete(record.id)}
            okText="확인"
            cancelText="취소"
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
            <h2 style={{ margin: 0 }}>{t('userManagement.title')}</h2>
          </Col>
          <Col>
            <Space>
              <Search
                placeholder={t('table.search')}
                allowClear
                style={{ width: 250 }}
                onChange={(e) => setSearchText(e.target.value)}
                prefix={<SearchOutlined />}
              />
              <Button
                icon={<ReloadOutlined />}
                onClick={loadUsers}
                loading={loading}
              >
                {t('table.refresh')}
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleAdd}
              >
                {t('table.addUser').substring(2)}
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <Table
          columns={columns}
          dataSource={filteredUsers}
          rowKey="id"
          loading={loading}
          pagination={{
            total: filteredUsers.length,
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => 
              t('table.pagination.showTotal', { start: range[0], end: range[1], total }),
          }}
          scroll={{ x: 1000 }}
        />
      </Card>

      <UserForm
        visible={formVisible}
        onCancel={handleFormCancel}
        onSuccess={handleFormSuccess}
        user={editingUser}
      />
    </div>
  );
};

export default UserManagement;