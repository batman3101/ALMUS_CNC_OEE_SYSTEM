'use client';

import React, { useState } from 'react';
import { Form, Input, Button, Card, Alert, Typography } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/contexts/AuthContext';
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


        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Typography.Text type="secondary" style={{ fontSize: '12px' }}>
            {t('auth.systemInfo')}
          </Typography.Text>
        </div>
      </Card>
    </div>
  );
};

export default LoginForm;