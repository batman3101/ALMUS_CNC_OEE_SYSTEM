'use client';

import React, { useState, useEffect } from 'react';
import { 
  Form, 
  Switch, 
  InputNumber, 
  Button, 
  Space, 
  Card,
  Typography,
  Row,
  Col,
  ColorPicker,
  Alert,
  Divider,
  Select,
  theme
} from 'antd';
import { SaveOutlined, EyeOutlined, BgColorsOutlined } from '@ant-design/icons';
import type { Color } from 'antd/es/color-picker';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplaySettings } from '@/hooks/useSystemSettings';
import { systemSettingsService } from '@/lib/systemSettings';
import { useSettingsFormState } from '../useSettingsFormState';
import { useMessage } from '@/hooks/useMessage';
import { useFailureReport } from '@/hooks/useFailureReport';

const { Title, Text } = Typography;

interface DisplaySettingsTabProps {
  /** 편집이 시작되면 true, 저장/되돌리기로 정리되면 false. */
  onDirtyChange?: (dirty: boolean) => void;
}

const DisplaySettingsTab: React.FC<DisplaySettingsTabProps> = ({ onDirtyChange }) => {
  const { token } = theme.useToken();
  const { t } = useLanguage();
  const { settings } = useDisplaySettings();
  // 실패 보고는 전부 reportFailure 로 나갔다 — 여기 남은 건 성공 안내뿐이다.
  const { success: showSuccess, contextHolder } = useMessage();
  const reportFailure = useFailureReport();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const { hydrate, markSaved, markDirty, revertToSaved, canRevert } =
    useSettingsFormState<Record<string, unknown>>(form, onDirtyChange);

  // 폼 초기값 설정 (`||` 대신 `??` — 저장된 false/0 을 코드 기본값으로 덮지 않는다)
  //
  // `show_machine_images` 는 더 이상 폼에 없다. 설비 스키마에 이미지 컬럼 자체가 없어서
  // 켜든 끄든 렌더링될 이미지가 존재하지 않는다 — 연결할 소비처가 없는 게 아니라
  // 연결할 **데이터**가 없다. 스위치를 남겨 두면 "켰는데 아무 일도 안 일어난다"가 되므로
  // 화면에서 내린다. DB 행은 지우지 않는다(설비 이미지 기능이 생기면 그때 다시 노출).
  useEffect(() => {
    if (settings) {
      hydrate({
        theme_mode: settings.theme_mode ?? 'light',
        theme_primary_color: settings.theme_primary_color ?? '#1890ff',
        theme_success_color: settings.theme_success_color ?? '#52c41a',
        theme_warning_color: settings.theme_warning_color ?? '#faad14',
        theme_error_color: settings.theme_error_color ?? '#ff4d4f',
        dashboard_refresh_interval_seconds: settings.dashboard_refresh_interval_seconds ?? 30,
        chart_animation_enabled: settings.chart_animation_enabled ?? true,
        compact_mode: settings.compact_mode ?? false,
        sidebar_collapsed: settings.sidebar_collapsed ?? false
      });
    }
  }, [settings, hydrate]);

  // 설정 저장
  const handleSave = async (values: Record<string, unknown>) => {
    try {
      setLoading(true);
      
      // 색상 값 처리
      const getColorString = (val: unknown, defaultColor: string): string => {
        if (typeof val === 'string') return val;
        const colorVal = val as { toHexString?: () => string } | undefined;
        return colorVal?.toHexString?.() || defaultColor;
      };

      const processedValues = {
        ...values,
        theme_primary_color: getColorString(values.theme_primary_color, '#1890ff'),
        theme_success_color: getColorString(values.theme_success_color, '#52c41a'),
        theme_warning_color: getColorString(values.theme_warning_color, '#faad14'),
        theme_error_color: getColorString(values.theme_error_color, '#ff4d4f')
      };

      // **한 트랜잭션**으로 저장한다. 예전에는 9건을 for 루프로 따로 저장했다. 색상 4개는
      // 하나의 팔레트라서, 주 색상만 바뀌고 경고 색상이 예전 값으로 남으면 화면 전체가
      // 어느 팔레트도 아닌 상태가 된다.
      const result = await systemSettingsService.updateSettingsAtomic(
        Object.entries(processedValues).map(([key, value]) => ({
          category: 'display',
          setting_key: key,
          setting_value: value,
        })),
        'Updated display settings',
      );
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update display settings');
      }

      // 테마 색상 즉시 적용
      applyThemeColors(processedValues);

      showSuccess(t('settings.saveSuccess'));
      markSaved(processedValues);
    } catch (error) {
      console.error('Error saving display settings:', error);
      reportFailure(t('settings.saveError'), error);
    } finally {
      setLoading(false);
    }
  };

  // 테마 색상 적용
  const applyThemeColors = (colors: Record<string, unknown>) => {
    const root = document.documentElement;
    root.style.setProperty('--ant-primary-color', String(colors.theme_primary_color || ''));
    root.style.setProperty('--ant-success-color', String(colors.theme_success_color || ''));
    root.style.setProperty('--ant-warning-color', String(colors.theme_warning_color || ''));
    root.style.setProperty('--ant-error-color', String(colors.theme_error_color || ''));
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
    showSuccess(t('settings.display.colorsReset'));
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
      {contextHolder}
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
        onValuesChange={markDirty}
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
              {/*
                2026-07-14(d355df1) 이후 테마는 개인 환경설정이 우선이다
                (UserPreferencesContext: user.theme_mode ?? systemTheme). 이 값은 개인 테마를
                고른 적 없는 계정에만 적용된다 — 관리자 본인 화면은 바뀌지 않는다.
              */}
              <Alert
                message={t('settings.display.themeModeScopeNote')}
                type="info"
                showIcon
                style={{ marginBottom: '24px' }}
              />
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
                name="sidebar_collapsed"
                label={t('settings.display.sidebarCollapsed')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>

              <Alert
                message={t('settings.display.interfaceHint')}
                type="info"
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

          <div style={{ marginTop: '16px', padding: '12px', backgroundColor: token.colorFillAlter, borderRadius: '6px' }}>
            <Text strong>{t('settings.display.currentSettings')}: </Text>
            <br />
            <Text>
              {t('settings.display.themeMode')}: {formValues.theme_mode === 'dark' ? t('settings.display.darkMode') : t('settings.display.lightMode')} | 
              {t('settings.display.refreshInterval')}: {formValues.dashboard_refresh_interval_seconds || 30}{t('common.seconds')} | 
              {t('settings.display.chartAnimation')}: {formValues.chart_animation_enabled ? t('common.enabled') : t('common.disabled')} | 
              {t('settings.display.compactMode')}: {formValues.compact_mode ? t('common.enabled') : t('common.disabled')}
            </Text>
          </div>
        </Card>

        <div style={{ marginTop: '24px', textAlign: 'right' }}>
          <Space>
            <Button onClick={revertToSaved} disabled={!canRevert}>
              {t('settings.revertToSaved')}
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