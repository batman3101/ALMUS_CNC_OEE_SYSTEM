'use client';

import React, { useState, useEffect } from 'react';
import { 
  Form, 
  Switch, 
  Input, 
  InputNumber, 
  Button, 
  Space, 
  message, 
  Card,
  Typography,
  Row,
  Col,
  Alert,
  Divider
} from 'antd';
import { SaveOutlined, BellOutlined, MailOutlined, SoundOutlined } from '@ant-design/icons';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNotificationSettings } from '@/hooks/useSystemSettings';

const { Title, Text } = Typography;

interface NotificationSettingsTabProps {
  onSettingsChange?: () => void;
}

const NotificationSettingsTab: React.FC<NotificationSettingsTabProps> = ({ onSettingsChange }) => {
  const { t } = useLanguage();
  const { settings, updateSetting } = useNotificationSettings();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>('default');

  // 폼 초기값 설정
  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        email_notifications_enabled: settings.email_notifications_enabled || false,
        browser_notifications_enabled: settings.browser_notifications_enabled || false,
        sound_notifications_enabled: settings.sound_notifications_enabled || false,
        notification_email: settings.notification_email || '',
        alert_check_interval_seconds: settings.alert_check_interval_seconds || 60
      });
    }
  }, [settings, form]);

  // 브라우저 알림 권한 확인
  useEffect(() => {
    if ('Notification' in window) {
      setBrowserPermission(Notification.permission);
    }
  }, []);

  // 설정 저장
  const handleSave = async (values: any) => {
    try {
      setLoading(true);
      
      // 이메일 형식 검증
      if (values.email_notifications_enabled && values.notification_email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(values.notification_email)) {
          message.error(t('settings.notification.invalidEmail'));
          return;
        }
      }

      const updates = Object.entries(values).map(([key, value]) => ({
        key,
        value,
        reason: `Updated notification ${key} setting`
      }));

      for (const update of updates) {
        const success = await updateSetting(update.key, update.value, update.reason);
        if (!success) {
          throw new Error(`Failed to update ${update.key}`);
        }
      }

      message.success(t('settings.saveSuccess'));
      onSettingsChange?.();
    } catch (error) {
      console.error('Error saving notification settings:', error);
      message.error(t('settings.saveError'));
    } finally {
      setLoading(false);
    }
  };

  // 브라우저 알림 권한 요청
  const requestBrowserPermission = async () => {
    if ('Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        setBrowserPermission(permission);
        
        if (permission === 'granted') {
          message.success(t('settings.notification.permissionGranted'));
          // 테스트 알림 표시
          new Notification(t('settings.notification.testTitle'), {
            body: t('settings.notification.testBody'),
            icon: '/favicon.ico'
          });
        } else {
          message.warning(t('settings.notification.permissionDenied'));
        }
      } catch (error) {
        console.error('Error requesting notification permission:', error);
        message.error(t('settings.notification.permissionError'));
      }
    }
  };

  // 테스트 알림 발송
  const sendTestNotification = () => {
    if (browserPermission === 'granted') {
      new Notification(t('settings.notification.testTitle'), {
        body: t('settings.notification.testBody'),
        icon: '/favicon.ico'
      });
      message.success(t('settings.notification.testSent'));
    } else {
      message.warning(t('settings.notification.permissionRequired'));
    }
  };

  // 현재 폼 값 가져오기
  const formValues = Form.useWatch([], form) || {};

  return (
    <div>
      <Title level={4} style={{ marginBottom: '24px' }}>
        {t('settings.notification.title')}
      </Title>

      <Alert
        message={t('settings.notification.description')}
        type="info"
        showIcon
        style={{ marginBottom: '24px' }}
      />
      
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        size="large"
      >
        <Row gutter={[24, 0]}>
          <Col xs={24} lg={12}>
            <Card 
              title={
                <span>
                  <BellOutlined style={{ marginRight: '8px' }} />
                  {t('settings.notification.browserNotifications')}
                </span>
              } 
              size="small"
            >
              <Form.Item
                name="browser_notifications_enabled"
                label={t('settings.notification.enableBrowser')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>

              <div style={{ marginBottom: '16px' }}>
                <Text strong>{t('settings.notification.permission')}: </Text>
                <Text 
                  type={
                    browserPermission === 'granted' ? 'success' : 
                    browserPermission === 'denied' ? 'danger' : 'warning'
                  }
                >
                  {t(`settings.notification.${browserPermission}`)}
                </Text>
              </div>

              <Space>
                <Button 
                  onClick={requestBrowserPermission}
                  disabled={browserPermission === 'granted'}
                  size="small"
                >
                  {t('settings.notification.requestPermission')}
                </Button>
                <Button 
                  onClick={sendTestNotification}
                  disabled={browserPermission !== 'granted'}
                  size="small"
                >
                  {t('settings.notification.testNotification')}
                </Button>
              </Space>

              <Alert
                message={t('settings.notification.browserHint')}
                type="info"
                size="small"
                style={{ marginTop: '12px' }}
              />
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card 
              title={
                <span>
                  <MailOutlined style={{ marginRight: '8px' }} />
                  {t('settings.notification.emailNotifications')}
                </span>
              } 
              size="small"
            >
              <Form.Item
                name="email_notifications_enabled"
                label={t('settings.notification.enableEmail')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>

              <Form.Item
                name="notification_email"
                label={t('settings.notification.emailAddress')}
                rules={[
                  {
                    type: 'email',
                    message: t('settings.notification.invalidEmail')
                  },
                  {
                    required: formValues.email_notifications_enabled,
                    message: t('settings.notification.emailRequired')
                  }
                ]}
              >
                <Input
                  placeholder={t('settings.notification.emailPlaceholder')}
                  disabled={!formValues.email_notifications_enabled}
                />
              </Form.Item>

              <Alert
                message={t('settings.notification.emailHint')}
                type="info"
                size="small"
              />
            </Card>
          </Col>
        </Row>

        <Divider />

        <Row gutter={[24, 0]}>
          <Col xs={24} lg={12}>
            <Card 
              title={
                <span>
                  <SoundOutlined style={{ marginRight: '8px' }} />
                  {t('settings.notification.soundSettings')}
                </span>
              } 
              size="small"
            >
              <Form.Item
                name="sound_notifications_enabled"
                label={t('settings.notification.enableSound')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>

              <Alert
                message={t('settings.notification.soundHint')}
                type="info"
                size="small"
              />
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card title={t('settings.notification.advanced')} size="small">
              <Form.Item
                name="alert_check_interval_seconds"
                label={t('settings.notification.checkInterval')}
                rules={[
                  { required: true, message: t('settings.notification.checkIntervalRequired') },
                  { type: 'number', min: 10, max: 300, message: t('settings.notification.checkIntervalRange') }
                ]}
              >
                <InputNumber
                  min={10}
                  max={300}
                  step={10}
                  style={{ width: '100%' }}
                  addonAfter={t('common.seconds')}
                />
              </Form.Item>

              <Alert
                message={t('settings.notification.intervalHint')}
                type="info"
                size="small"
              />
            </Card>
          </Col>
        </Row>

        {/* 알림 설정 요약 */}
        <Card title={t('settings.notification.summary')} size="small" style={{ marginTop: '24px' }}>
          <Row gutter={[16, 8]}>
            <Col span={8}>
              <Text strong>{t('settings.notification.browserNotifications')}: </Text>
              <Text type={formValues.browser_notifications_enabled ? 'success' : 'secondary'}>
                {formValues.browser_notifications_enabled ? t('common.enabled') : t('common.disabled')}
              </Text>
            </Col>
            <Col span={8}>
              <Text strong>{t('settings.notification.emailNotifications')}: </Text>
              <Text type={formValues.email_notifications_enabled ? 'success' : 'secondary'}>
                {formValues.email_notifications_enabled ? t('common.enabled') : t('common.disabled')}
              </Text>
            </Col>
            <Col span={8}>
              <Text strong>{t('settings.notification.soundNotifications')}: </Text>
              <Text type={formValues.sound_notifications_enabled ? 'success' : 'secondary'}>
                {formValues.sound_notifications_enabled ? t('common.enabled') : t('common.disabled')}
              </Text>
            </Col>
          </Row>
          
          <div style={{ marginTop: '12px' }}>
            <Text strong>{t('settings.notification.checkInterval')}: </Text>
            <Text>{formValues.alert_check_interval_seconds || 60}{t('common.seconds')}</Text>
          </div>
        </Card>

        <div style={{ marginTop: '24px', textAlign: 'right' }}>
          <Space>
            <Button onClick={() => form.resetFields()}>
              {t('common.reset')}
            </Button>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              icon={<SaveOutlined />}
            >
              {t('common.save')}
            </Button>
          </Space>
        </div>
      </Form>
    </div>
  );
};

export default NotificationSettingsTab;