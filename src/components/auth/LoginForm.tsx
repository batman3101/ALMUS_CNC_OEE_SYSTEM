'use client';

import React, { useState } from 'react';
import { Form, Input, Button, Card, Alert, Typography, Divider, Tag, Space } from 'antd';
import { UserOutlined, LockOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/contexts/AuthContext';
import { MockAuthService, isDevelopment } from '@/lib/mockAuth';
import { AppError, ErrorCodes } from '@/types';

const { Title } = Typography;

interface LoginFormProps {
  onSuccess?: () => void;
  onError?: (error: AppError) => void;
}

interface LoginFormData {
  email: string;
  password: string;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onSuccess, onError }) => {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 개발 환경에서 기본값 설정
  React.useEffect(() => {
    if (isDevelopment()) {
      form.setFieldsValue({
        email: 'zetooo1972@gmail.com',
        password: 'youkillme-1972'
      });
    }
  }, [form]);

  const handleSubmit = async (values: LoginFormData) => {
    setLoading(true);
    setError(null);

    try {
      await login(values.email, values.password);
      onSuccess?.();
    } catch (err: any) {
      console.error('Login error:', err);
      
      let errorMessage = t('auth.loginFailed');
      const errorCode = ErrorCodes.AUTHENTICATION_FAILED;

      if (err.message?.includes('Invalid login credentials') || 
          err.message?.includes('이메일 또는 비밀번호가 올바르지 않습니다')) {
        errorMessage = t('auth.invalidCredentials');
      } else if (err.message?.includes('Email not confirmed')) {
        errorMessage = t('auth.emailNotConfirmed');
      } else if (err.message?.includes('Too many requests')) {
        errorMessage = t('auth.tooManyRequests');
      }

      const appError: AppError = {
        code: errorCode,
        message: errorMessage,
        details: err
      };

      setError(errorMessage);
      onError?.(appError);
    } finally {
      setLoading(false);
    }
  };

  // 개발 계정으로 빠른 로그인
  const handleQuickLogin = (email: string, password: string) => {
    form.setFieldsValue({ email, password });
    handleSubmit({ email, password });
  };

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '100vh',
      background: '#f0f2f5'
    }}>
      <Card 
        style={{ 
          width: 400, 
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)' 
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={2} style={{ marginBottom: 8 }}>
            {t('auth.login')}
          </Title>
          <Typography.Text type="secondary">
            {t('auth.loginSubtitle')}
          </Typography.Text>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <Form
          form={form}
          name="login"
          onFinish={handleSubmit}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="email"
            rules={[
              {
                required: true,
                message: t('auth.emailRequired'),
              },
              {
                type: 'email',
                message: t('auth.emailInvalid'),
              },
            ]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder={t('auth.emailPlaceholder')}
              autoComplete="email"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[
              {
                required: true,
                message: t('auth.passwordRequired'),
              },
              {
                min: 6,
                message: t('auth.passwordMinLength'),
              },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder={t('auth.passwordPlaceholder')}
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              style={{ width: '100%' }}
            >
              {loading ? t('auth.loggingIn') : t('auth.login')}
            </Button>
          </Form.Item>
        </Form>

        {/* 개발 환경에서만 표시되는 테스트 계정 정보 */}
        {isDevelopment() && (
          <>
            <Divider>
              <Typography.Text type="secondary" style={{ fontSize: '12px' }}>
                <InfoCircleOutlined /> 개발 모드 - 테스트 계정
              </Typography.Text>
            </Divider>
            
            <div style={{ marginBottom: 16 }}>
              {MockAuthService.getAvailableUsers().map((user, index) => (
                <div key={user.id} style={{ marginBottom: 8 }}>
                  <Space size="small" style={{ width: '100%', justifyContent: 'space-between' }}>
                    <div>
                      <Tag color={user.role === 'admin' ? 'red' : user.role === 'engineer' ? 'blue' : 'green'}>
                        {user.role === 'admin' ? '관리자' : user.role === 'engineer' ? '엔지니어' : '운영자'}
                      </Tag>
                      <Typography.Text style={{ fontSize: '12px' }}>
                        {user.name}
                      </Typography.Text>
                    </div>
                    <Button 
                      size="small" 
                      type="link"
                      onClick={() => handleQuickLogin(user.email, index === 0 ? 'youkillme-1972' : 'test123')}
                    >
                      로그인
                    </Button>
                  </Space>
                  <div style={{ fontSize: '11px', color: '#999', marginLeft: 8 }}>
                    {user.email}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Typography.Text type="secondary" style={{ fontSize: '12px' }}>
            {isDevelopment() ? '🔧 개발 모드 - 모의 데이터 사용 중' : t('auth.systemInfo')}
          </Typography.Text>
        </div>
      </Card>
    </div>
  );
};

export default LoginForm;