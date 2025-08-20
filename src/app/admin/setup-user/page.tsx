'use client';

import React, { useState, useEffect } from 'react';
import { 
  Card, 
  Button, 
  Form, 
  Input, 
  Select, 
  Table, 
  message, 
  Typography, 
  Space, 
  Divider,
  Tag,
  Alert
} from 'antd';
import { UserAddOutlined, ReloadOutlined, CheckCircleOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { Option } = Select;

interface AuthUser {
  id: string;
  email: string;
  created_at: string;
  email_confirmed_at?: string;
  last_sign_in_at?: string;
  hasProfile: boolean;
  profileInfo?: {
    name: string;
    role: string;
    email: string;
  };
}

interface SetupUserData {
  email: string;
  name: string;
  role: string;
}

const SetupUserPage: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [authUsers, setAuthUsers] = useState<AuthUser[]>([]);
  const [fetchingUsers, setFetchingUsers] = useState(false);

  // Authentication 사용자 목록 가져오기
  const fetchAuthUsers = async () => {
    setFetchingUsers(true);
    try {
      const response = await fetch('/api/admin/setup-real-user');
      const data = await response.json();
      
      if (data.authUsers) {
        setAuthUsers(data.authUsers);
        message.success(`${data.totalCount}명의 사용자를 찾았습니다`);
      } else {
        message.error('사용자 목록을 불러오는데 실패했습니다');
      }
    } catch (error) {
      console.error('Error fetching auth users:', error);
      message.error('사용자 목록을 불러오는데 실패했습니다');
    } finally {
      setFetchingUsers(false);
    }
  };

  // 실제 사용자 등록
  const handleSetupUser = async (values: SetupUserData) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/setup-real-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      });

      const data = await response.json();
      
      if (data.success) {
        message.success('사용자가 성공적으로 등록되었습니다!');
        form.resetFields();
        fetchAuthUsers(); // 목록 새로고침
      } else {
        message.error(data.error || '사용자 등록에 실패했습니다');
      }
    } catch (error) {
      console.error('Error setting up user:', error);
      message.error('사용자 등록 중 오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  };

  // 사용자 선택 시 이메일 자동 입력
  const handleUserSelect = (userId: string) => {
    const selectedUser = authUsers.find(user => user.id === userId);
    if (selectedUser) {
      form.setFieldValue('email', selectedUser.email);
    }
  };

  useEffect(() => {
    fetchAuthUsers();
  }, []);

  const columns = [
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      render: (email: string) => <Text code>{email}</Text>,
    },
    {
      title: '가입일',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => new Date(date).toLocaleDateString(),
    },
    {
      title: '이메일 인증',
      dataIndex: 'email_confirmed_at',
      key: 'email_confirmed_at',
      render: (date?: string) => (
        date ? (
          <Tag color="green">인증 완료</Tag>
        ) : (
          <Tag color="orange">미인증</Tag>
        )
      ),
    },
    {
      title: '프로필 상태',
      dataIndex: 'hasProfile',
      key: 'hasProfile',
      render: (hasProfile: boolean, record: AuthUser) => (
        hasProfile ? (
          <Space>
            <Tag color="blue">등록됨</Tag>
            <Text type="secondary">
              {record.profileInfo?.name} ({record.profileInfo?.role})
            </Text>
          </Space>
        ) : (
          <Tag color="red">미등록</Tag>
        )
      ),
    },
    {
      title: '마지막 로그인',
      dataIndex: 'last_sign_in_at',
      key: 'last_sign_in_at',
      render: (date?: string) => (
        date ? new Date(date).toLocaleString() : '-'
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Title level={2}>
        <UserAddOutlined /> 실제 사용자 계정 설정
      </Title>
      
      <Alert
        message="실제 계정 등록"
        description="Supabase Authentication에 등록된 실제 사용자를 user_profiles 테이블에 등록하여 시스템에 접근할 수 있도록 설정합니다."
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Card title="새 사용자 등록" style={{ marginBottom: 24 }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSetupUser}
          initialValues={{ role: 'admin' }}
        >
          <Form.Item
            name="email"
            label="이메일"
            rules={[
              { required: true, message: '이메일을 입력해주세요' },
              { type: 'email', message: '올바른 이메일 형식이 아닙니다' }
            ]}
          >
            <Input placeholder="실제 사용자 이메일 주소" />
          </Form.Item>

          <Form.Item
            name="name"
            label="사용자 이름"
            rules={[
              { required: true, message: '사용자 이름을 입력해주세요' }
            ]}
          >
            <Input placeholder="실제 사용자 이름" />
          </Form.Item>

          <Form.Item
            name="role"
            label="역할"
            rules={[
              { required: true, message: '역할을 선택해주세요' }
            ]}
          >
            <Select>
              <Option value="admin">관리자 (Admin)</Option>
              <Option value="engineer">엔지니어 (Engineer)</Option>
              <Option value="operator">운영자 (Operator)</Option>
            </Select>
          </Form.Item>

          <Form.Item>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              icon={<CheckCircleOutlined />}
            >
              사용자 등록
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card 
        title="Authentication 사용자 목록" 
        extra={
          <Button 
            onClick={fetchAuthUsers}
            loading={fetchingUsers}
            icon={<ReloadOutlined />}
          >
            새로고침
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={authUsers}
          rowKey="id"
          loading={fetchingUsers}
          pagination={{
            pageSize: 10,
            showTotal: (total) => `총 ${total}명`,
          }}
          onRow={(record) => ({
            onClick: () => {
              if (!record.hasProfile) {
                handleUserSelect(record.id);
              }
            },
            style: {
              cursor: !record.hasProfile ? 'pointer' : 'default',
              backgroundColor: !record.hasProfile ? '#f6ffed' : undefined,
            },
          })}
        />
        
        <Divider />
        
        <Text type="secondary">
          💡 팁: 프로필이 없는 사용자(미등록)를 클릭하면 이메일이 자동으로 입력됩니다.
        </Text>
      </Card>
    </div>
  );
};

export default SetupUserPage;