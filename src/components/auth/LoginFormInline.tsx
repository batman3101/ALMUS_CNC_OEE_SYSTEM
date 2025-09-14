'use client';

import React, { useState } from 'react';
import { Form, Input, Button, Alert, Typography, Divider, Tag, Space } from 'antd';
import { UserOutlined, LockOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/contexts/AuthContext';
import { MockAuthService, isDevelopment } from '@/lib/mockAuth';
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

  // 개발 계정으로 빠른 로그인
  const handleQuickLogin = (email: string, password: string) => {
    form.setFieldsValue({ email, password });
    handleSubmit({ email, password });
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

      {/* 테스트 계정 정보 비활성화 - 실제 계정만 사용 */}
      {false && isDevelopment() && (
        <>
          <Divider>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              <InfoCircleOutlined /> 개발 모드 - 테스트 계정
            </Text>
          </Divider>
          
          <div style={{ marginBottom: 16 }}>
            {MockAuthService.getAvailableUsers().map((user, index) => (
              <div key={user.id} style={{ marginBottom: 12 }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'var(--ant-color-bg-container)',
                  border: '1px solid var(--ant-color-border)',
                  borderRadius: '6px'
                }}>
                  <div>
                    <div style={{ marginBottom: 4 }}>
                      <Tag 
                        color={user.role === 'admin' ? 'red' : user.role === 'engineer' ? 'blue' : 'green'}
                        style={{ color: 'white' }}
                      >
                        {user.role === 'admin' ? '관리자' : user.role === 'engineer' ? '엔지니어' : '운영자'}
                      </Tag>
                      <Text style={{ fontSize: '13px', fontWeight: 500 }}>
                        {user.name}
                      </Text>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--ant-color-text-secondary)' }}>
                      {user.email}
                    </div>
                  </div>
                  <Button 
                    size="small" 
                    type="link"
                    onClick={() => handleQuickLogin(user.email, index === 0 ? 'youkillme-1972' : 'test123')}
                  >
                    로그인
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ textAlign: 'center', marginTop: 24 }}>
        <Text type="secondary" style={{ fontSize: '12px' }}>
          {isDevelopment() ? '신규 사용자 가입은 운영자에게 문의' : t('auth.systemInfo')}
        </Text>
      </div>
    </div>
  );
};

export default LoginFormInline;