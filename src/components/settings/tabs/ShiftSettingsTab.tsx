'use client';

import React, { useState, useEffect } from 'react';
import { 
  Form, 
  TimePicker, 
  InputNumber, 
  Button, 
  Space, 
  Card,
  Typography,
  Row,
  Col,
  Alert,
  Divider,
  theme
} from 'antd';
import { SaveOutlined, ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useLanguage } from '@/contexts/LanguageContext';
import { useShiftSettings } from '@/hooks/useSystemSettings';
import { useMessage } from '@/hooks/useMessage';

const { Title, Text } = Typography;

interface ShiftSettingsTabProps {
  onSettingsChange?: () => void;
}

const ShiftSettingsTab: React.FC<ShiftSettingsTabProps> = ({ onSettingsChange }) => {
  const { token } = theme.useToken();
  const { t } = useLanguage();
  const { settings, updateSetting } = useShiftSettings();
  const { success: showSuccess, error: showError, contextHolder } = useMessage();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  // 폼 초기값 설정
  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        shift_a_start: settings.shift_a_start ? dayjs(settings.shift_a_start, 'HH:mm') : dayjs('08:00', 'HH:mm'),
        shift_a_end: settings.shift_a_end ? dayjs(settings.shift_a_end, 'HH:mm') : dayjs('20:00', 'HH:mm'),
        shift_b_start: settings.shift_b_start ? dayjs(settings.shift_b_start, 'HH:mm') : dayjs('20:00', 'HH:mm'),
        shift_b_end: settings.shift_b_end ? dayjs(settings.shift_b_end, 'HH:mm') : dayjs('08:00', 'HH:mm'),
        break_time_minutes: settings.break_time_minutes || 60,
        shift_change_buffer_minutes: settings.shift_change_buffer_minutes || 15
      });
    }
  }, [settings, form]);

  // 설정 저장
  const handleSave = async (values: {
    shift_a_start: dayjs.Dayjs;
    shift_a_end: dayjs.Dayjs;
    shift_b_start: dayjs.Dayjs;
    shift_b_end: dayjs.Dayjs;
    break_time_minutes: number;
    shift_change_buffer_minutes?: number;
  }) => {
    try {
      setLoading(true);
      
      // 시간 값을 문자열로 변환
      const processedValues = {
        shift_a_start: values.shift_a_start.format('HH:mm'),
        shift_a_end: values.shift_a_end.format('HH:mm'),
        shift_b_start: values.shift_b_start.format('HH:mm'),
        shift_b_end: values.shift_b_end.format('HH:mm'),
        break_time_minutes: values.break_time_minutes,
        shift_change_buffer_minutes: values.shift_change_buffer_minutes
      };

      // 교대 시간 검증
      const aStart = dayjs(processedValues.shift_a_start, 'HH:mm');
      const aEnd = dayjs(processedValues.shift_a_end, 'HH:mm');
      // B shift times are unused for now but kept for future validation
      // const bStart = dayjs(processedValues.shift_b_start, 'HH:mm');
      // const bEnd = dayjs(processedValues.shift_b_end, 'HH:mm');

      // A교대 시간 검증 (같은 날)
      if (aStart.isAfter(aEnd)) {
        showError(t('settings.shift.aShiftTimeError'));
        return;
      }

      // B교대는 다음날까지 이어지므로 별도 검증 불필요

      const updates = Object.entries(processedValues).map(([key, value]) => ({
        key,
        value,
        reason: `Updated shift ${key} setting`
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
      console.error('Error saving shift settings:', error);
      showError(t('settings.saveError'));
    } finally {
      setLoading(false);
    }
  };

  // 현재 폼 값 가져오기
  const formValues = Form.useWatch([], form) || {};

  // 교대 시간 계산
  const calculateShiftDuration = (start: dayjs.Dayjs | undefined, end: dayjs.Dayjs | undefined, isNightShift = false): number => {
    if (!start || !end) return 0;
    
    let duration;
    if (isNightShift) {
      // B교대는 다음날까지 이어짐
      const nextDayEnd = end.add(1, 'day');
      duration = nextDayEnd.diff(start, 'minute');
    } else {
      duration = end.diff(start, 'minute');
    }
    
    return Math.max(0, duration);
  };

  // 실제 작업 시간 계산 (휴식 시간 제외)
  const calculateWorkingTime = (totalMinutes: number, breakMinutes: number) => {
    return Math.max(0, totalMinutes - breakMinutes);
  };

  const aShiftDuration = calculateShiftDuration(formValues.shift_a_start, formValues.shift_a_end);
  const bShiftDuration = calculateShiftDuration(formValues.shift_b_start, formValues.shift_b_end, true);
  const breakTime = formValues.break_time_minutes || 60;

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ marginBottom: '24px' }}>
        {t('settings.shift.title')}
      </Title>

      <Alert
        message={t('settings.shift.description')}
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
                  <ClockCircleOutlined style={{ marginRight: '8px' }} />
                  {t('settings.shift.aShift')}
                </span>
              } 
              size="small"
            >
              <Form.Item
                name="shift_a_start"
                label={t('settings.shift.startTime')}
                rules={[{ required: true, message: t('settings.shift.startTimeRequired') }]}
              >
                <TimePicker
                  format="HH:mm"
                  style={{ width: '100%' }}
                  placeholder={t('settings.shift.selectTime')}
                />
              </Form.Item>

              <Form.Item
                name="shift_a_end"
                label={t('settings.shift.endTime')}
                rules={[{ required: true, message: t('settings.shift.endTimeRequired') }]}
              >
                <TimePicker
                  format="HH:mm"
                  style={{ width: '100%' }}
                  placeholder={t('settings.shift.selectTime')}
                />
              </Form.Item>

              <div style={{ padding: '12px', backgroundColor: token.colorFillAlter, borderRadius: '6px' }}>
                <Text strong>{t('settings.shift.duration')}: </Text>
                <Text>{Math.floor(aShiftDuration / 60)}시간 {aShiftDuration % 60}분</Text>
                <br />
                <Text strong>{t('settings.shift.workingTime')}: </Text>
                <Text>{Math.floor(calculateWorkingTime(aShiftDuration, breakTime) / 60)}시간 {calculateWorkingTime(aShiftDuration, breakTime) % 60}분</Text>
              </div>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card 
              title={
                <span>
                  <ClockCircleOutlined style={{ marginRight: '8px' }} />
                  {t('settings.shift.bShift')}
                </span>
              } 
              size="small"
            >
              <Form.Item
                name="shift_b_start"
                label={t('settings.shift.startTime')}
                rules={[{ required: true, message: t('settings.shift.startTimeRequired') }]}
              >
                <TimePicker
                  format="HH:mm"
                  style={{ width: '100%' }}
                  placeholder={t('settings.shift.selectTime')}
                />
              </Form.Item>

              <Form.Item
                name="shift_b_end"
                label={`${t('settings.shift.endTime')} (${t('settings.shift.nextDay')})`}
                rules={[{ required: true, message: t('settings.shift.endTimeRequired') }]}
              >
                <TimePicker
                  format="HH:mm"
                  style={{ width: '100%' }}
                  placeholder={t('settings.shift.selectTime')}
                />
              </Form.Item>

              <div style={{ padding: '12px', backgroundColor: token.colorFillAlter, borderRadius: '6px' }}>
                <Text strong>{t('settings.shift.duration')}: </Text>
                <Text>{Math.floor(bShiftDuration / 60)}시간 {bShiftDuration % 60}분</Text>
                <br />
                <Text strong>{t('settings.shift.workingTime')}: </Text>
                <Text>{Math.floor(calculateWorkingTime(bShiftDuration, breakTime) / 60)}시간 {calculateWorkingTime(bShiftDuration, breakTime) % 60}분</Text>
              </div>
            </Card>
          </Col>
        </Row>

        <Divider />

        <Row gutter={[24, 0]}>
          <Col xs={24} lg={12}>
            <Card title={t('settings.shift.breakSettings')} size="small">
              <Form.Item
                name="break_time_minutes"
                label={t('settings.shift.breakTime')}
                rules={[
                  { required: true, message: t('settings.shift.breakTimeRequired') },
                  { type: 'number', min: 0, max: 240, message: t('settings.shift.breakTimeRange') }
                ]}
              >
                <InputNumber
                  min={0}
                  max={240}
                  step={5}
                  style={{ width: '100%' }}
                  addonAfter={t('common.minutes')}
                />
              </Form.Item>

              <Form.Item
                name="shift_change_buffer_minutes"
                label={t('settings.shift.bufferTime')}
                rules={[
                  { type: 'number', min: 0, max: 60, message: t('settings.shift.bufferTimeRange') }
                ]}
              >
                <InputNumber
                  min={0}
                  max={60}
                  step={5}
                  style={{ width: '100%' }}
                  addonAfter={t('common.minutes')}
                />
              </Form.Item>

              <Alert
                message={t('settings.shift.bufferTimeHint')}
                type="info"
                showIcon
                size="small"
              />
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card title={t('settings.shift.summary')} size="small">
              <div style={{ padding: '16px', backgroundColor: token.colorFillAlter, borderRadius: '6px' }}>
                <div style={{ marginBottom: '12px' }}>
                  <Text strong>{t('settings.shift.totalCoverage')}: </Text>
                  <Text>24시간</Text>
                </div>
                
                <div style={{ marginBottom: '12px' }}>
                  <Text strong>{t('settings.shift.totalWorkingTime')}: </Text>
                  <Text>
                    {Math.floor((calculateWorkingTime(aShiftDuration, breakTime) + calculateWorkingTime(bShiftDuration, breakTime)) / 60)}시간 {(calculateWorkingTime(aShiftDuration, breakTime) + calculateWorkingTime(bShiftDuration, breakTime)) % 60}분
                  </Text>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <Text strong>{t('settings.shift.totalBreakTime')}: </Text>
                  <Text>{breakTime * 2}분 (교대당 {breakTime}분)</Text>
                </div>

                <div>
                  <Text strong>{t('settings.shift.efficiency')}: </Text>
                  <Text>
                    {(((calculateWorkingTime(aShiftDuration, breakTime) + calculateWorkingTime(bShiftDuration, breakTime)) / (24 * 60)) * 100).toFixed(1)}%
                  </Text>
                </div>
              </div>
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

export default ShiftSettingsTab;