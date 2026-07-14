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
import { useAdminTranslation } from '@/hooks/useTranslation';

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
  const { t } = useAdminTranslation();
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
        message.success(t('setupUser.messages.usersFound', { count: data.totalCount }));
      } else {
        message.error(t('setupUser.messages.fetchUsersFailed'));
      }
    } catch (error) {
      console.error('Error fetching auth users:', error);
      message.error(t('setupUser.messages.fetchUsersFailed'));
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
        message.success(t('setupUser.messages.userRegistered'));
        form.resetFields();
        fetchAuthUsers(); // 목록 새로고침
      } else {
        message.error(data.error || t('setupUser.messages.userRegisterFailed'));
      }
    } catch (error) {
      console.error('Error setting up user:', error);
      message.error(t('setupUser.messages.userRegisterError'));
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
      title: t('setupUser.columns.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => new Date(date).toLocaleDateString(),
    },
    {
      title: t('setupUser.columns.emailVerified'),
      dataIndex: 'email_confirmed_at',
      key: 'email_confirmed_at',
      render: (date?: string) => (
        date ? (
          <Tag color="green">{t('setupUser.tags.verified')}</Tag>
        ) : (
          <Tag color="orange">{t('setupUser.tags.unverified')}</Tag>
        )
      ),
    },
    {
      title: t('setupUser.columns.profileStatus'),
      dataIndex: 'hasProfile',
      key: 'hasProfile',
      render: (hasProfile: boolean, record: AuthUser) => (
        hasProfile ? (
          <Space>
            <Tag color="blue">{t('setupUser.tags.registered')}</Tag>
            <Text type="secondary">
              {record.profileInfo?.name} ({record.profileInfo?.role})
            </Text>
          </Space>
        ) : (
          <Tag color="red">{t('setupUser.tags.unregistered')}</Tag>
        )
      ),
    },
    {
      title: t('setupUser.columns.lastLogin'),
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
        <UserAddOutlined /> {t('setupUser.page.title')}
      </Title>

      <Alert
        message={t('setupUser.alerts.title')}
        description={t('setupUser.alerts.description')}
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Card title={t('setupUser.cards.newUserTitle')} style={{ marginBottom: 24 }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSetupUser}
          initialValues={{ role: 'admin' }}
        >
          <Form.Item
            name="email"
            label={t('setupUser.fields.email')}
            rules={[
              { required: true, message: t('setupUser.validation.emailRequired') },
              { type: 'email', message: t('setupUser.validation.emailInvalid') }
            ]}
          >
            <Input placeholder={t('setupUser.placeholders.email')} />
          </Form.Item>

          <Form.Item
            name="name"
            label={t('setupUser.fields.name')}
            rules={[
              { required: true, message: t('setupUser.validation.nameRequired') }
            ]}
          >
            <Input placeholder={t('setupUser.placeholders.name')} />
          </Form.Item>

          <Form.Item
            name="role"
            label={t('setupUser.fields.role')}
            rules={[
              { required: true, message: t('setupUser.validation.roleRequired') }
            ]}
          >
            <Select>
              <Option value="admin">{t('setupUser.roleOptions.admin')}</Option>
              <Option value="engineer">{t('setupUser.roleOptions.engineer')}</Option>
              <Option value="operator">{t('setupUser.roleOptions.operator')}</Option>
            </Select>
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              icon={<CheckCircleOutlined />}
            >
              {t('setupUser.buttons.register')}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card
        title={t('setupUser.cards.userListTitle')}
        extra={
          <Button
            onClick={fetchAuthUsers}
            loading={fetchingUsers}
            icon={<ReloadOutlined />}
          >
            {t('table.refresh')}
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
            showTotal: (total) => t('setupUser.table.showTotal', { total }),
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
          {t('setupUser.tips.selectUnregistered')}
        </Text>
      </Card>
    </div>
  );
};

export default SetupUserPage;