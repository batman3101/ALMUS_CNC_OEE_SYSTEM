'use client';

import React, { useState } from 'react';
import { Form, Input, Button, Alert, Typography } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/contexts/AuthContext';
import { AppError, ErrorCodes } from '@/types';

const { Text } = Typography;

interface LoginFormInlineProps {
  onSuccess?: () => void;
  onError?: (error: AppError) => void;
}

interface LoginFormData {
  email: string;
  password: string;
}

export const LoginFormInline: React.FC<LoginFormInlineProps> = ({ onSuccess, onError }) => {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 자동 로그인 비활성화 - 항상 수동으로 입력하도록 변경
  // React.useEffect(() => {
  //   if (isDevelopment()) {
  //     form.setFieldsValue({
  //       email: 'zetooo1972@gmail.com',
  //       password: 'youkillme-1972'
  //     });
  //   }
  // }, [form]);

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
    <div>
      {error && (
        <Alert
          message={error}
          type="error"
          showIcon
          style={{ marginBottom: 24 }}
        />
      )}

      <Form
        form={form}
        name="login"
        onFinish={handleSubmit}
        autoComplete="off"
        size="large"
        layout="vertical"
      >
        <Form.Item
          name="email"
          label="이메일"
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
          label="비밀번호"
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

        <Form.Item style={{ marginBottom: 32 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            style={{ 
              width: '100%',
              height: 48,
              fontSize: '16px',
              fontWeight: 500
            }}
          >
            {loading ? t('auth.loggingIn') : t('auth.login')}
          </Button>
        </Form.Item>
      </Form>


      <div style={{ textAlign: 'center', marginTop: 24 }}>
        <Text type="secondary" style={{ fontSize: '12px' }}>
          신규 사용자 가입은 운영자에게 문의
        </Text>
      </div>
    </div>
  );
};

export default LoginFormInline;