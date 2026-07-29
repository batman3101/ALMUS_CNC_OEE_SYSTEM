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
  //
  // 종료 시각(shift_a_end / shift_b_end)은 폼에 넣지 않는다. 서버는 교대 창을
  // `A = [A시작, B시작)`, `B = [B시작, 다음날 A시작)` 으로 만들며(downtimeIntervals.
  // buildShiftWindows) 저장된 종료 시각을 **읽지 않는다**. 예전 폼은 종료 시각을 저장까지
  // 했기 때문에, 관리자가 A교대 종료를 19:30 으로 바꾸면 UI 는 저장에 성공했다고 말하지만
  // 서버 OEE 시간창은 계속 20:00 을 썼다(Codex 감사 2026-07-29 #9).
  //
  // 이 시스템의 실제 모델은 연속 2교대다 — A가 끝나면 B가 시작한다. 간격이나 중첩은 애초에
  // 표현할 수 없는 개념인데, 표현할 수 있는 척하는 UI 가 문제였다. 그래서 종료 시각은
  // 시작 시각에서 파생해 **보여주기만** 한다.
  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        shift_a_start: settings.shift_a_start ? dayjs(settings.shift_a_start, 'HH:mm') : dayjs('08:00', 'HH:mm'),
        shift_b_start: settings.shift_b_start ? dayjs(settings.shift_b_start, 'HH:mm') : dayjs('20:00', 'HH:mm'),
        break_time_minutes: settings.break_time_minutes || 60,
        shift_change_buffer_minutes: settings.shift_change_buffer_minutes || 15
      });
    }
  }, [settings, form]);

  // 설정 저장
  const handleSave = async (values: {
    shift_a_start: dayjs.Dayjs;
    shift_b_start: dayjs.Dayjs;
    break_time_minutes: number;
    shift_change_buffer_minutes?: number;
  }) => {
    try {
      setLoading(true);

      // 서버가 읽는 키만 저장한다. 종료 시각은 시작 시각에서 파생되므로 저장하지 않는다 —
      // 저장하면 서버가 무시하는 값을 관리자가 설정한 것처럼 보이게 된다.
      const processedValues = {
        shift_a_start: values.shift_a_start.format('HH:mm'),
        shift_b_start: values.shift_b_start.format('HH:mm'),
        break_time_minutes: values.break_time_minutes,
        shift_change_buffer_minutes: values.shift_change_buffer_minutes
      };

      // 두 교대 시작 시각이 같으면 한쪽 교대의 길이가 0이 되고, 다른 쪽이 24시간이 된다.
      if (processedValues.shift_a_start === processedValues.shift_b_start) {
        showError(t('settings.shift.aShiftTimeError'));
        return;
      }

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

  /**
   * 한 교대의 길이. 종료는 **다음 교대 시작**이며, 그 시각이 시작보다 이르거나 같으면
   * 자정을 넘긴 것이므로 24시간을 더한다. 서버의 buildShiftWindows 와 같은 규칙이라
   * 화면과 OEE 계산이 같은 창을 말한다.
   */
  const calculateShiftDuration = (
    start: dayjs.Dayjs | undefined,
    nextShiftStart: dayjs.Dayjs | undefined
  ): number => {
    if (!start || !nextShiftStart) return 0;

    const diff = nextShiftStart.diff(start, 'minute');
    return diff > 0 ? diff : diff + 24 * 60;
  };

  // 실제 작업 시간 계산 (휴식 시간 제외)
  const calculateWorkingTime = (totalMinutes: number, breakMinutes: number) => {
    return Math.max(0, totalMinutes - breakMinutes);
  };

  // 종료 시각은 저장된 값이 아니라 다음 교대 시작에서 파생한다.
  const aShiftEnd: dayjs.Dayjs | undefined = formValues.shift_b_start;
  const bShiftEnd: dayjs.Dayjs | undefined = formValues.shift_a_start;

  const aShiftDuration = calculateShiftDuration(formValues.shift_a_start, aShiftEnd);
  const bShiftDuration = calculateShiftDuration(formValues.shift_b_start, bShiftEnd);
  const breakTime = formValues.break_time_minutes || 60;

  /** 파생된 종료 시각을 입력칸이 아닌 읽기 전용 표시로 보여준다. */
  const derivedEndTime = (value: dayjs.Dayjs | undefined, hint: string) => (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ marginBottom: '8px' }}>
        <Text type="secondary">{t('settings.shift.endTime')}</Text>
      </div>
      <div
        style={{
          padding: '8px 12px',
          backgroundColor: token.colorFillAlter,
          borderRadius: '6px',
          border: `1px dashed ${token.colorBorder}`,
        }}
      >
        <Text strong style={{ fontSize: '16px' }}>{value ? value.format('HH:mm') : '--:--'}</Text>
        <br />
        <Text type="secondary" style={{ fontSize: '12px' }}>{hint}</Text>
      </div>
    </div>
  );

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

              {derivedEndTime(aShiftEnd, t('settings.shift.endTimeDerivedFromB'))}

              <div style={{ padding: '12px', backgroundColor: token.colorFillAlter, borderRadius: '6px' }}>
                <Text strong>{t('settings.shift.duration')}: </Text>
                <Text>{t('settings.shift.hoursMinutes', { h: Math.floor(aShiftDuration / 60), m: aShiftDuration % 60 })}</Text>
                <br />
                <Text strong>{t('settings.shift.workingTime')}: </Text>
                <Text>{t('settings.shift.hoursMinutes', { h: Math.floor(calculateWorkingTime(aShiftDuration, breakTime) / 60), m: calculateWorkingTime(aShiftDuration, breakTime) % 60 })}</Text>
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

              {derivedEndTime(bShiftEnd, t('settings.shift.endTimeDerivedFromA'))}

              <div style={{ padding: '12px', backgroundColor: token.colorFillAlter, borderRadius: '6px' }}>
                <Text strong>{t('settings.shift.duration')}: </Text>
                <Text>{t('settings.shift.hoursMinutes', { h: Math.floor(bShiftDuration / 60), m: bShiftDuration % 60 })}</Text>
                <br />
                <Text strong>{t('settings.shift.workingTime')}: </Text>
                <Text>{t('settings.shift.hoursMinutes', { h: Math.floor(calculateWorkingTime(bShiftDuration, breakTime) / 60), m: calculateWorkingTime(bShiftDuration, breakTime) % 60 })}</Text>
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
              />
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card title={t('settings.shift.summary')} size="small">
              <div style={{ padding: '16px', backgroundColor: token.colorFillAlter, borderRadius: '6px' }}>
                <div style={{ marginBottom: '12px' }}>
                  <Text strong>{t('settings.shift.totalCoverage')}: </Text>
                  <Text>{t('settings.shift.fullDay')}</Text>
                </div>
                
                <div style={{ marginBottom: '12px' }}>
                  <Text strong>{t('settings.shift.totalWorkingTime')}: </Text>
                  <Text>
                    {t('settings.shift.hoursMinutes', {
                      h: Math.floor((calculateWorkingTime(aShiftDuration, breakTime) + calculateWorkingTime(bShiftDuration, breakTime)) / 60),
                      m: (calculateWorkingTime(aShiftDuration, breakTime) + calculateWorkingTime(bShiftDuration, breakTime)) % 60
                    })}
                  </Text>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <Text strong>{t('settings.shift.totalBreakTime')}: </Text>
                  <Text>{t('settings.shift.breakPerShift', { total: breakTime * 2, each: breakTime })}</Text>
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