'use client';

import React, { useState, useEffect } from 'react';
import { 
  Table, 
  Button, 
  Space, 
  Input, 
  Tag, 
  Popconfirm, 
  message,
  Card,
  Row,
  Col
} from 'antd';
import { 
  PlusOutlined, 
  EditOutlined, 
  DeleteOutlined, 
  SearchOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from '@/hooks/useTranslation';
import { useAdminOperations } from '@/hooks/useAdminOperations';
import type { User } from '@/types';
import UserForm from './UserForm';

const { Search } = Input;

interface UserWithProfile extends User {
  email: string;
}

const UserManagement: React.FC = () => {
  const { t } = useTranslation();
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
      message.error('오류가 발생했습니다');
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleDelete = async (userId: string) => {
    try {
      await deleteUser(userId);
      message.success('사용자가 성공적으로 삭제되었습니다');
      loadUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
      message.error('사용자 삭제 중 오류가 발생했습니다');
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
      title: '이름',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: '이메일',
      dataIndex: 'email',
      key: 'email',
      sorter: (a, b) => a.email.localeCompare(b.email),
    },
    {
      title: '역할',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        const roleLabels = {
          admin: '관리자',
          engineer: '엔지니어',
          operator: '운영자'
        };
        return (
          <Tag color={getRoleColor(role)}>
            {roleLabels[role as keyof typeof roleLabels]}
          </Tag>
        );
      },
      filters: [
        { text: '관리자', value: 'admin' },
        { text: '엔지니어', value: 'engineer' },
        { text: '운영자', value: 'operator' },
      ],
      onFilter: (value, record) => record.role === value,
    },
    {
      title: '담당 설비',
      dataIndex: 'assigned_machines',
      key: 'assigned_machines',
      render: (machines: string[] | null) => {
        if (!machines || machines.length === 0) {
          return <span style={{ color: '#999' }}>-</span>;
        }
        return (
          <span>
            {machines.length}개 설비
          </span>
        );
      },
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
            title="이 사용자를 삭제하시겠습니까?"
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
            <h2 style={{ margin: 0 }}>사용자 관리</h2>
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
                onClick={loadUsers}
                loading={loading}
              >
                새로고침
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleAdd}
              >
                사용자 추가
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
              `${range[0]}-${range[1]} / ${total}개 항목`,
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