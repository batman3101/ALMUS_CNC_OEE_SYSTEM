'use client';

import React, { useState, useEffect } from 'react';
import { 
  Form, 
  InputNumber, 
  Button, 
  Space, 
  Card,
  Typography,
  Row,
  Col,
  Slider,
  Progress,
  Alert,
  theme
} from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOEESettings } from '@/hooks/useSystemSettings';
import { useMessage } from '@/hooks/useMessage';

const { Title, Text } = Typography;

interface OEESettingsTabProps {
  onSettingsChange?: () => void;
}

const OEESettingsTab: React.FC<OEESettingsTabProps> = ({ onSettingsChange }) => {
  const { token } = theme.useToken();
  const { t } = useLanguage();
  const { settings, updateSetting } = useOEESettings();
  const { success: showSuccess, error: showError, contextHolder } = useMessage();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  // 폼 초기값 설정
  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        target_oee: settings.target_oee || 0.85,
        target_availability: settings.target_availability || 0.90,
        target_performance: settings.target_performance || 0.95,
        target_quality: settings.target_quality || 0.99,
        low_oee_threshold: settings.low_oee_threshold || 0.60,
        critical_oee_threshold: settings.critical_oee_threshold || 0.40,
        downtime_alert_minutes: settings.downtime_alert_minutes || 30
      });
    }
  }, [settings, form]);

  // 설정 저장
  const handleSave = async (values: Record<string, number>) => {
    try {
      setLoading(true);
      
      // 값 검증
      if (values.critical_oee_threshold >= values.low_oee_threshold) {
        showError(t('settings.oee.thresholdValidation'));
        return;
      }

      if (values.low_oee_threshold >= values.target_oee) {
        showError(t('settings.oee.targetValidation'));
        return;
      }

      const updates = Object.entries(values).map(([key, value]) => ({
        key,
        value,
        reason: `Updated OEE ${key} setting`
      }));

      for (const update of updates) {
        const success = await updateSetting(update.key, update.value, update.reason);
        if (!success) {
          throw new Error(`Failed to update ${update.key}`);
        }
      }

      showSuccess(t('settings.saveSuccess'));
      onSettingsChange?.();
    } catch (error) {
      console.error('Error saving OEE settings:', error);
      showError(t('settings.saveError'));
    } finally {
      setLoading(false);
    }
  };

  // 현재 폼 값 가져오기
  const formValues = Form.useWatch([], form) || {};

  // OEE 계산 예시
  const calculateExampleOEE = () => {
    const availability = formValues.target_availability || 0.90;
    const performance = formValues.target_performance || 0.95;
    const quality = formValues.target_quality || 0.99;
    return availability * performance * quality;
  };

  // 임계값 색상 결정
  const getThresholdColor = (value: number) => {
    const critical = formValues.critical_oee_threshold || 0.40;
    const low = formValues.low_oee_threshold || 0.60;
    const target = formValues.target_oee || 0.85;

    if (value < critical) return '#ff4d4f';
    if (value < low) return '#faad14';
    if (value < target) return '#1890ff';
    return '#52c41a';
  };

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ marginBottom: '24px' }}>
        {t('settings.oee.title')}
      </Title>

      <Alert
        message={t('settings.oee.description')}
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
            <Card title={t('settings.oee.targets')} size="small">
              <Form.Item
                name="target_oee"
                label={t('settings.oee.targetOEE')}
                rules={[
                  { required: true, message: t('settings.oee.targetOEERequired') },
                  { type: 'number', min: 0, max: 1, message: t('settings.oee.valueRange') }
                ]}
              >
                <div>
                  <InputNumber
                    min={0}
                    max={1}
                    step={0.01}
                    precision={2}
                    style={{ width: '100%' }}
                    formatter={value => `${(Number(value) * 100).toFixed(0)}%`}
                    parser={value => Number(value!.replace('%', '')) / 100}
                  />
                  <Slider
                    min={0}
                    max={1}
                    step={0.01}
                    value={formValues.target_oee}
                    onChange={(value) => form.setFieldValue('target_oee', value)}
                    tooltip={{ formatter: (value) => `${(value! * 100).toFixed(0)}%` }}
                    style={{ marginTop: '8px' }}
                  />
                </div>
              </Form.Item>

              <Form.Item
                name="target_availability"
                label={t('settings.oee.targetAvailability')}
                rules={[
                  { required: true, message: t('settings.oee.targetAvailabilityRequired') },
                  { type: 'number', min: 0, max: 1, message: t('settings.oee.valueRange') }
                ]}
              >
                <div>
                  <InputNumber
                    min={0}
                    max={1}
                    step={0.01}
                    precision={2}
                    style={{ width: '100%' }}
                    formatter={value => `${(Number(value) * 100).toFixed(0)}%`}
                    parser={value => Number(value!.replace('%', '')) / 100}
                  />
                  <Slider
                    min={0}
                    max={1}
                    step={0.01}
                    value={formValues.target_availability}
                    onChange={(value) => form.setFieldValue('target_availability', value)}
                    tooltip={{ formatter: (value) => `${(value! * 100).toFixed(0)}%` }}
                    style={{ marginTop: '8px' }}
                  />
                </div>
              </Form.Item>

              <Form.Item
                name="target_performance"
                label={t('settings.oee.targetPerformance')}
                rules={[
                  { required: true, message: t('settings.oee.targetPerformanceRequired') },
                  { type: 'number', min: 0, max: 2, message: t('settings.oee.performanceRange') }
                ]}
              >
                <div>
                  <InputNumber
                    min={0}
                    max={2}
                    step={0.01}
                    precision={2}
                    style={{ width: '100%' }}
                    formatter={value => `${(Number(value) * 100).toFixed(0)}%`}
                    parser={value => Number(value!.replace('%', '')) / 100}
                  />
                  <Slider
                    min={0}
                    max={2}
                    step={0.01}
                    value={formValues.target_performance}
                    onChange={(value) => form.setFieldValue('target_performance', value)}
                    tooltip={{ formatter: (value) => `${(value! * 100).toFixed(0)}%` }}
                    style={{ marginTop: '8px' }}
                  />
                </div>
              </Form.Item>

              <Form.Item
                name="target_quality"
                label={t('settings.oee.targetQuality')}
                rules={[
                  { required: true, message: t('settings.oee.targetQualityRequired') },
                  { type: 'number', min: 0, max: 1, message: t('settings.oee.valueRange') }
                ]}
              >
                <div>
                  <InputNumber
                    min={0}
                    max={1}
                    step={0.01}
                    precision={2}
                    style={{ width: '100%' }}
                    formatter={value => `${(Number(value) * 100).toFixed(0)}%`}
                    parser={value => Number(value!.replace('%', '')) / 100}
                  />
                  <Slider
                    min={0}
                    max={1}
                    step={0.01}
                    value={formValues.target_quality}
                    onChange={(value) => form.setFieldValue('target_quality', value)}
                    tooltip={{ formatter: (value) => `${(value! * 100).toFixed(0)}%` }}
                    style={{ marginTop: '8px' }}
                  />
                </div>
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card title={t('settings.oee.thresholds')} size="small">
              <Form.Item
                name="low_oee_threshold"
                label={t('settings.oee.lowThreshold')}
                rules={[
                  { required: true, message: t('settings.oee.lowThresholdRequired') },
                  { type: 'number', min: 0, max: 1, message: t('settings.oee.valueRange') }
                ]}
              >
                <div>
                  <InputNumber
                    min={0}
                    max={1}
                    step={0.01}
                    precision={2}
                    style={{ width: '100%' }}
                    formatter={value => `${(Number(value) * 100).toFixed(0)}%`}
                    parser={value => Number(value!.replace('%', '')) / 100}
                  />
                  <Slider
                    min={0}
                    max={1}
                    step={0.01}
                    value={formValues.low_oee_threshold}
                    onChange={(value) => form.setFieldValue('low_oee_threshold', value)}
                    tooltip={{ formatter: (value) => `${(value! * 100).toFixed(0)}%` }}
                    style={{ marginTop: '8px' }}
                  />
                </div>
              </Form.Item>

              <Form.Item
                name="critical_oee_threshold"
                label={t('settings.oee.criticalThreshold')}
                rules={[
                  { required: true, message: t('settings.oee.criticalThresholdRequired') },
                  { type: 'number', min: 0, max: 1, message: t('settings.oee.valueRange') }
                ]}
              >
                <div>
                  <InputNumber
                    min={0}
                    max={1}
                    step={0.01}
                    precision={2}
                    style={{ width: '100%' }}
                    formatter={value => `${(Number(value) * 100).toFixed(0)}%`}
                    parser={value => Number(value!.replace('%', '')) / 100}
                  />
                  <Slider
                    min={0}
                    max={1}
                    step={0.01}
                    value={formValues.critical_oee_threshold}
                    onChange={(value) => form.setFieldValue('critical_oee_threshold', value)}
                    tooltip={{ formatter: (value) => `${(value! * 100).toFixed(0)}%` }}
                    style={{ marginTop: '8px' }}
                  />
                </div>
              </Form.Item>

              <Form.Item
                name="downtime_alert_minutes"
                label={t('settings.oee.downtimeAlert')}
                rules={[
                  { required: true, message: t('settings.oee.downtimeAlertRequired') },
                  { type: 'number', min: 1, max: 480, message: t('settings.oee.downtimeRange') }
                ]}
              >
                <InputNumber
                  min={1}
                  max={480}
                  step={5}
                  style={{ width: '100%' }}
                  addonAfter={t('common.minutes')}
                />
              </Form.Item>

              {/* OEE 계산 예시 */}
              <Card size="small" style={{ marginTop: '16px', backgroundColor: token.colorFillAlter }}>
                <Text strong>{t('settings.oee.calculationExample')}</Text>
                <div style={{ marginTop: '8px' }}>
                  <Progress
                    percent={Math.round(calculateExampleOEE() * 100)}
                    strokeColor={getThresholdColor(calculateExampleOEE())}
                    format={(percent) => `${percent}%`}
                  />
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    {t('settings.oee.formula')}: {((formValues.target_availability || 0.90) * 100).toFixed(0)}% × {((formValues.target_performance || 0.95) * 100).toFixed(0)}% × {((formValues.target_quality || 0.99) * 100).toFixed(0)}% = {(calculateExampleOEE() * 100).toFixed(1)}%
                  </Text>
                </div>
              </Card>
            </Card>
          </Col>
        </Row>

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

export default OEESettingsTab;