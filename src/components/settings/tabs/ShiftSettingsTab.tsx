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
import { resolveBreakMinutes, resolveShiftChangeBufferMinutes } from '@/lib/shiftDefaults';
import { TOTAL_BREAK_MINUTES } from '@/utils/shiftBreaks';
import { systemSettingsService } from '@/lib/systemSettings';
import { useSettingsFormState } from '../useSettingsFormState';
import { useLanguage } from '@/contexts/LanguageContext';
import { useShiftSettings } from '@/hooks/useSystemSettings';
import { useMessage } from '@/hooks/useMessage';
import { useFailureReport } from '@/hooks/useFailureReport';

const { Title, Text } = Typography;

/**
 * 실시간 계산 엔진이 실제로 지원하는 교대 모델.
 *
 * `src/utils/shiftBreaks.ts` 의 휴식 시간대는 **720분 교대를 전제로 하드코딩**돼 있고
 * (`BREAK_WINDOWS_END_OFFSET_MINUTES = 600`), `calculateRealtimeProgress` 는 교대가 그보다
 * 짧으면 아예 예외를 던진다. `MachineConsole` 도 `operatingMinutes === 720` 이 아니면
 * 실시간 지표를 통째로 감춘다. 휴식 총량 역시 110분(TOTAL_BREAK_MINUTES)이 아니면
 * `/api/production-progress` 가 `break_config_matches: false` 로 계산을 중단한다.
 *
 * 즉 UI 가 허용해 온 "임의의 시작 시각 + 0~240분 휴식"은 **저장은 되지만 지원되지 않는**
 * 값이었다. 저장에 성공한 뒤 설비 콘솔의 실시간 화면만 조용히 사라지고, 관리자는 그 둘을
 * 연결 짓지 못한다. 확정 OEE 는 새 설정을 따르는데 실시간만 죽으므로 증상은 더 헷갈린다.
 *
 * 그래서 지금은 UI 를 엔진이 감당하는 범위로 좁힌다. 가변 교대를 제품 요구로 되살리려면
 * shiftBreaks 의 시간대를 설정 기반으로 바꾸고 자정 교차·비대칭 교대 회귀 테스트를 먼저
 * 갖춘 뒤 이 상수를 풀어야 한다.
 */
const SUPPORTED_SHIFT_MINUTES = 720;

interface ShiftSettingsTabProps {
  /** 편집이 시작되면 true, 저장/되돌리기로 정리되면 false. */
  onDirtyChange?: (dirty: boolean) => void;
}

const ShiftSettingsTab: React.FC<ShiftSettingsTabProps> = ({ onDirtyChange }) => {
  const { token } = theme.useToken();
  const { t } = useLanguage();
  // updateSetting(단건)은 더 쓰지 않는다 — 교대 설정 네 값은 서로를 해석하므로
  // updateSettingsAtomic 으로 한 트랜잭션에 저장한다(적대적 재감사 #9).
  const { settings } = useShiftSettings();
  const { success: showSuccess, error: showError, contextHolder } = useMessage();
  const reportFailure = useFailureReport();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const { hydrate, markSaved, markDirty, revertToSaved, canRevert } =
    useSettingsFormState<Record<string, unknown>>(form, onDirtyChange);

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
      hydrate({
        shift_a_start: settings.shift_a_start ? dayjs(settings.shift_a_start, 'HH:mm') : dayjs('08:00', 'HH:mm'),
        shift_b_start: settings.shift_b_start ? dayjs(settings.shift_b_start, 'HH:mm') : dayjs('20:00', 'HH:mm'),
        // `||` 이 아니라 `??` 여야 한다. 관리자가 **명시적으로 0** 을 설정한 경우
        // (휴식 없음 / 전환 유예 없음) `||` 는 그걸 falsy 로 보고 기본값으로 되돌린다.
        // 화면은 60·15 를 보여주는데 DB 에는 0 이 들어 있는 상태가 되고, 저장을 누르면
        // 관리자가 고른 적 없는 값이 저장된다(적대적 재감사 #9).
        break_time_minutes: resolveBreakMinutes(settings.break_time_minutes),
        // 기본값 15 는 서버(`src/lib/shiftConfig.ts` = 10)와 달랐다. 설정이 비어 있을 때
        // 화면과 서버가 서로 다른 값으로 계산하게 된다 — 같은 상수를 쓴다.
        shift_change_buffer_minutes:
          resolveShiftChangeBufferMinutes(settings.shift_change_buffer_minutes)
      });
    }
  }, [settings, hydrate]);

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

      // 짧은 쪽 교대보다 긴 휴식은 계획가동시간을 0으로 만든다(planned = max(0, 가동−휴식)).
      // 그러면 availability 가 계산 불가가 되어 OEE 가 통째로 NULL 이 된다 — 저장 전에 막는다.
      const toMinutes = (hhmm: string) => {
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + m;
      };
      const aStart = toMinutes(processedValues.shift_a_start);
      const bStart = toMinutes(processedValues.shift_b_start);
      const shortestShift = Math.min(
        (bStart - aStart + 1440) % 1440,
        (aStart - bStart + 1440) % 1440,
      );
      const breakMinutes = processedValues.break_time_minutes;
      const bufferMinutes = processedValues.shift_change_buffer_minutes;

      // 엔진이 감당하는 교대 길이는 720분뿐이다. 이 검사가 없으면 비대칭 교대를 저장할 수
      // 있고, 저장 직후 설비 콘솔의 실시간 지표가 통째로 사라진다(위 SUPPORTED_SHIFT_MINUTES 주석).
      if (shortestShift !== SUPPORTED_SHIFT_MINUTES) {
        showError(t('settings.shift.durationUnsupported', { supported: SUPPORTED_SHIFT_MINUTES }));
        return;
      }

      // 휴식 총량도 마찬가지다. shiftBreaks 의 시간대 합계와 다르면
      // /api/production-progress 가 break_config_matches: false 로 계산을 멈춘다.
      if (breakMinutes !== TOTAL_BREAK_MINUTES) {
        showError(t('settings.shift.breakUnsupported', { supported: TOTAL_BREAK_MINUTES }));
        return;
      }

      if (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes >= shortestShift) {
        showError(`휴식 시간은 0 이상이고 짧은 교대(${shortestShift}분)보다 작아야 합니다.`);
        return;
      }
      // 유예가 교대 길이를 넘으면 다음 교대가 시작된 뒤에도 이전 교대 진척을 받게 된다.
      if (
        bufferMinutes === undefined ||
        !Number.isFinite(bufferMinutes) ||
        bufferMinutes < 0 ||
        bufferMinutes >= shortestShift
      ) {
        showError(`교대 전환 유예는 0 이상이고 짧은 교대(${shortestShift}분)보다 작아야 합니다.`);
        return;
      }

      // 네 값을 **한 트랜잭션**으로 저장한다(적대적 재감사 #9).
      //
      // 예전에는 for 루프로 네 번 따로 저장하고 실패하면 throw 했다. 세 번째에서 실패하면
      // 앞의 둘은 남고 뒤의 하나는 안 남는다 — 그런데 이 값들은 서로를 해석하는 값이라
      // 반쪽 상태는 "어느 세대의 규칙으로 계산된 것인지 알 수 없는" 상태가 된다.
      const result = await systemSettingsService.updateSettingsAtomic(
        Object.entries(processedValues).map(([key, value]) => ({
          category: 'shift',
          setting_key: key,
          setting_value: value,
        })),
        'Updated shift settings',
      );
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update shift settings');
      }

      showSuccess(t('settings.saveSuccess'));
      markSaved(values as unknown as Record<string, unknown>);
    } catch (error) {
      console.error('Error saving shift settings:', error);
      reportFailure(t('settings.saveError'), error);
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
  // 폼 초기값(65행)과 **같은 규칙**이어야 한다. 여기만 `|| 60` 으로 남겨 뒀더니 브라우저
  // 테스트에서 바로 드러났다 — 휴식을 0으로 저장한 뒤 입력칸은 0 을 보여주는데 요약은
  // "교대당 60분", 작업 시간 11시간(=720−60)을 보여줬다. 한 화면 안에서 두 숫자가 서로
  // 다른 규칙을 따르는 상태다.
  //
  // 이 결함의 모양이 이번 감사 전체의 주제다: 같은 규칙이 두 곳에 흩어져 한쪽만 고쳐진다.
  // 고치는 쪽도 예외가 아니라서, 위를 고칠 때 여기를 같이 세지 않으면 그대로 반복된다.
  const breakTime = resolveBreakMinutes(formValues.break_time_minutes);

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
        onValuesChange={markDirty}
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
                  {
                    type: 'number',
                    min: TOTAL_BREAK_MINUTES,
                    max: TOTAL_BREAK_MINUTES,
                    message: t('settings.shift.breakUnsupported', { supported: TOTAL_BREAK_MINUTES }),
                  }
                ]}
              >
                {/* min = max = 지원값. "설정 가능한 값"과 "지원되는 값"을 같게 만든다. */}
                <InputNumber
                  min={TOTAL_BREAK_MINUTES}
                  max={TOTAL_BREAK_MINUTES}
                  step={5}
                  style={{ width: '100%' }}
                  addonAfter={t('common.minutes')}
                />
              </Form.Item>

              <Alert
                message={t('settings.shift.engineConstraint', {
                  shift: SUPPORTED_SHIFT_MINUTES,
                  brk: TOTAL_BREAK_MINUTES,
                })}
                type="warning"
                showIcon
                style={{ marginBottom: '24px' }}
              />

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

export default ShiftSettingsTab;