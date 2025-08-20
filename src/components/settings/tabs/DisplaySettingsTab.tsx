'use client';

import React, { useState, useEffect } from 'react';
import { 
  Form, 
  Switch, 
  InputNumber, 
  Button, 
  Space, 
  message, 
  Card,
  Typography,
  Row,
  Col,
  ColorPicker,
  Alert,
  Divider,
  Select
} from 'antd';
import { SaveOutlined, EyeOutlined, BgColorsOutlined } from '@ant-design/icons';
import type { Color } from 'antd/es/color-picker';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplaySettings } from '@/hooks/useSystemSettings';

const { Title, Text } = Typography;

interface DisplaySettingsTabProps {
  onSettingsChange?: () => void;
}

const DisplaySettingsTab: React.FC<DisplaySettingsTabProps> = ({ onSettingsChange }) => {
  const { t } = useLanguage();
  const { settings, updateSetting } = useDisplaySettings();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  // 폼 초기값 설정
  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        theme_mode: settings.theme_mode || 'light',
        theme_primary_color: settings.theme_primary_color || '#1890ff',
        theme_success_color: settings.theme_success_color || '#52c41a',
        theme_warning_color: settings.theme_warning_color || '#faad14',
        theme_error_color: settings.theme_error_color || '#ff4d4f',
        dashboard_refresh_interval_seconds: settings.dashboard_refresh_interval_seconds || 30,
        chart_animation_enabled: settings.chart_animation_enabled !== false,
        compact_mode: settings.compact_mode || false,
        show_machine_images: settings.show_machine_images !== false,
        sidebar_collapsed: settings.sidebar_collapsed || false
      });
    }
  }, [settings, form]);

  // 설정 저장
  const handleSave = async (values: any) => {
    try {
      setLoading(true);
      
      // 색상 값 처리
      const processedValues = {
        ...values,
        theme_primary_color: typeof values.theme_primary_color === 'string' 
          ? values.theme_primary_color 
          : values.theme_primary_color?.toHexString?.() || '#1890ff',
        theme_success_color: typeof values.theme_success_color === 'string' 
          ? values.theme_success_color 
          : values.theme_success_color?.toHexString?.() || '#52c41a',
        theme_warning_color: typeof values.theme_warning_color === 'string' 
          ? values.theme_warning_color 
          : values.theme_warning_color?.toHexString?.() || '#faad14',
        theme_error_color: typeof values.theme_error_color === 'string' 
          ? values.theme_error_color 
          : values.theme_error_color?.toHexString?.() || '#ff4d4f'
      };

      const updates = Object.entries(processedValues).map(([key, value]) => ({
        key,
        value,
        reason: `Updated display ${key} setting`
      }));

      for (const update of updates) {
        const success = await updateSetting(update.key, update.value, update.reason);
        if (!success) {
          throw new Error(`Failed to update ${update.key}`);
        }
      }

      // 테마 색상 즉시 적용
      applyThemeColors(processedValues);

      message.success(t('settings.saveSuccess'));
      onSettingsChange?.();
    } catch (error) {
      console.error('Error saving display settings:', error);
      message.error(t('settings.saveError'));
    } finally {
      setLoading(false);
    }
  };

  // 테마 색상 적용
  const applyThemeColors = (colors: any) => {
    const root = document.documentElement;
    root.style.setProperty('--ant-primary-color', colors.theme_primary_color);
    root.style.setProperty('--ant-success-color', colors.theme_success_color);
    root.style.setProperty('--ant-warning-color', colors.theme_warning_color);
    root.style.setProperty('--ant-error-color', colors.theme_error_color);
  };

  // 기본 색상으로 재설정
  const resetToDefaultColors = () => {
    const defaultColors = {
      theme_primary_color: '#1890ff',
      theme_success_color: '#52c41a',
      theme_warning_color: '#faad14',
      theme_error_color: '#ff4d4f'
    };

    form.setFieldsValue(defaultColors);
    applyThemeColors(defaultColors);
    message.success(t('settings.display.colorsReset'));
  };

  // 색상 미리보기
  const previewColor = (colorKey: string, color: Color | string) => {
    const colorValue = typeof color === 'string' ? color : color.toHexString();
    const root = document.documentElement;
    
    switch (colorKey) {
      case 'theme_primary_color':
        root.style.setProperty('--ant-primary-color', colorValue);
        break;
      case 'theme_success_color':
        root.style.setProperty('--ant-success-color', colorValue);
        break;
      case 'theme_warning_color':
        root.style.setProperty('--ant-warning-color', colorValue);
        break;
      case 'theme_error_color':
        root.style.setProperty('--ant-error-color', colorValue);
        break;
    }
  };

  // 현재 폼 값 가져오기
  const formValues = Form.useWatch([], form) || {};

  return (
    <div>
      <Title level={4} style={{ marginBottom: '24px' }}>
        {t('settings.display.title')}
      </Title>

      <Alert
        message={t('settings.display.description')}
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
                  <BgColorsOutlined style={{ marginRight: '8px' }} />
                  {t('settings.display.theme')}
                </span>
              } 
              size="small"
              extra={
                <Button size="small" onClick={resetToDefaultColors}>
                  {t('settings.display.resetColors')}
                </Button>
              }
            >
              <Form.Item
                name="theme_mode"
                label={t('settings.display.themeMode')}
              >
                <Select
                  options={[
                    { label: t('settings.display.lightMode'), value: 'light' },
                    { label: t('settings.display.darkMode'), value: 'dark' }
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="theme_primary_color"
                label={t('settings.display.primaryColor')}
              >
                <ColorPicker
                  value={formValues.theme_primary_color}
                  onChange={(color) => previewColor('theme_primary_color', color)}
                  showText
                  format="hex"
                  presets={[
                    {
                      label: t('settings.display.presetColors'),
                      colors: [
                        '#1890ff', '#722ed1', '#13c2c2', '#52c41a',
                        '#faad14', '#f5222d', '#fa541c', '#eb2f96'
                      ]
                    }
                  ]}
                />
              </Form.Item>

              <Form.Item
                name="theme_success_color"
                label={t('settings.display.successColor')}
              >
                <ColorPicker
                  value={formValues.theme_success_color}
                  onChange={(color) => previewColor('theme_success_color', color)}
                  showText
                  format="hex"
                />
              </Form.Item>

              <Form.Item
                name="theme_warning_color"
                label={t('settings.display.warningColor')}
              >
                <ColorPicker
                  value={formValues.theme_warning_color}
                  onChange={(color) => previewColor('theme_warning_color', color)}
                  showText
                  format="hex"
                />
              </Form.Item>

              <Form.Item
                name="theme_error_color"
                label={t('settings.display.errorColor')}
              >
                <ColorPicker
                  value={formValues.theme_error_color}
                  onChange={(color) => previewColor('theme_error_color', color)}
                  showText
                  format="hex"
                />
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card 
              title={
                <span>
                  <EyeOutlined style={{ marginRight: '8px' }} />
                  {t('settings.display.interface')}
                </span>
              } 
              size="small"
            >
              <Form.Item
                name="dashboard_refresh_interval_seconds"
                label={t('settings.display.refreshInterval')}
                rules={[
                  { required: true, message: t('settings.display.refreshIntervalRequired') },
                  { type: 'number', min: 5, max: 300, message: t('settings.display.refreshIntervalRange') }
                ]}
              >
                <InputNumber
                  min={5}
                  max={300}
                  step={5}
                  style={{ width: '100%' }}
                  addonAfter={t('common.seconds')}
                />
              </Form.Item>

              <Form.Item
                name="chart_animation_enabled"
                label={t('settings.display.chartAnimation')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>

              <Form.Item
                name="compact_mode"
                label={t('settings.display.compactMode')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>

              <Form.Item
                name="show_machine_images"
                label={t('settings.display.showMachineImages')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>

              <Form.Item
                name="sidebar_collapsed"
                label={t('settings.display.sidebarCollapsed')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>

              <Alert
                message={t('settings.display.interfaceHint')}
                type="info"
                size="small"
              />
            </Card>
          </Col>
        </Row>

        <Divider />

        {/* 설정 미리보기 */}
        <Card title={t('settings.display.preview')} size="small">
          <Row gutter={[16, 16]}>
            <Col span={6}>
              <div style={{ 
                padding: '12px', 
                backgroundColor: formValues.theme_primary_color || '#1890ff',
                color: 'white',
                borderRadius: '6px',
                textAlign: 'center'
              }}>
                {t('settings.display.primarySample')}
              </div>
            </Col>
            <Col span={6}>
              <div style={{ 
                padding: '12px', 
                backgroundColor: formValues.theme_success_color || '#52c41a',
                color: 'white',
                borderRadius: '6px',
                textAlign: 'center'
              }}>
                {t('settings.display.successSample')}
              </div>
            </Col>
            <Col span={6}>
              <div style={{ 
                padding: '12px', 
                backgroundColor: formValues.theme_warning_color || '#faad14',
                color: 'white',
                borderRadius: '6px',
                textAlign: 'center'
              }}>
                {t('settings.display.warningSample')}
              </div>
            </Col>
            <Col span={6}>
              <div style={{ 
                padding: '12px', 
                backgroundColor: formValues.theme_error_color || '#ff4d4f',
                color: 'white',
                borderRadius: '6px',
                textAlign: 'center'
              }}>
                {t('settings.display.errorSample')}
              </div>
            </Col>
          </Row>

          <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#fafafa', borderRadius: '6px' }}>
            <Text strong>{t('settings.display.currentSettings')}: </Text>
            <br />
            <Text>
              {t('settings.display.themeMode')}: {formValues.theme_mode === 'dark' ? t('settings.display.darkMode') : t('settings.display.lightMode')} | 
              {t('settings.display.refreshInterval')}: {formValues.dashboard_refresh_interval_seconds || 30}{t('common.seconds')} | 
              {t('settings.display.chartAnimation')}: {formValues.chart_animation_enabled ? t('common.enabled') : t('common.disabled')} | 
              {t('settings.display.compactMode')}: {formValues.compact_mode ? t('common.enabled') : t('common.disabled')} | 
              {t('settings.display.showMachineImages')}: {formValues.show_machine_images ? t('common.enabled') : t('common.disabled')}
            </Text>
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

export default DisplaySettingsTab;