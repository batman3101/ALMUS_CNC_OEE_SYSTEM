'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, InputNumber, Button, Space, Typography, Alert, DatePicker, Segmented, Collapse } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { authFetch } from '@/lib/authFetch';
import { useMachinesTranslation } from '@/hooks/useTranslation';

const { Text } = Typography;

interface Props {
  machineId: string;
  /** 현재 업무일·교대. 기본 선택(직전 교대)을 여기서 유도한다. */
  date: string;
  shift: 'A' | 'B';
  onClosed: () => void;
}

/**
 * 지난 교대 **직접** 마감.
 *
 * ## 왜 별도 진입점이 필요한가
 *
 * 주황색 마감대기 카드(`CloseShiftSection`)는 `production_progress_reports` 에 행이 있는
 * 교대만 보여준다. 그래서 작업자가 교대 중 누적수량을 **한 번도 저장하지 않으면** 그 교대는
 * 백로그에 잡히지 않고, 카드 자체가 렌더되지 않아(`if (!selected) return null`) 화면에서
 * 처리할 방법이 사라진다. 교대가 끝난 뒤 종이 카운터를 보고 처음 입력하는 흐름이 정확히
 * 그 경우다.
 *
 * 서버는 이미 이 흐름을 받아들인다 — `close-shift` 는 `final_qty` 가 있으면 진척 보고 없이도
 * 마감한다. 막혀 있던 것은 **UI 진입 경로뿐**이었다.
 *
 * ## 판정은 서버가 한다
 *
 * 여기서 고른 날짜·교대가 마감 가능한지는 서버가 `isShiftCloseAllowed` 로 최종 판정한다.
 * 클라이언트 시계로 미리 막지 않는 이유는 교대 시간·시간대가 시스템 설정이고, 그 설정은
 * 이 화면이 모르는 사이 바뀔 수 있기 때문이다. 이 화면은 **입력을 받는 곳**이지 권한을
 * 판단하는 곳이 아니다(현재·미래 교대는 서버가 400 으로 거부한다).
 */
export const ManualCloseShiftSection: React.FC<Props> = ({ machineId, date, shift, onClosed }) => {
  const { t } = useMachinesTranslation();

  /**
   * 기본값 = 직전 교대.
   *
   * A교대(08:00~20:00) 이전은 같은 업무일의 B교대가 아니라 **전날 B교대**다. B교대는 자정을
   * 넘지만 업무일은 시작일이므로, A 의 직전은 `date-1` 의 B 가 된다. 반대로 B 의 직전은 같은
   * 업무일의 A 다. 이 규칙을 틀리면 자정 직후에 엉뚱한 교대가 기본 선택된다.
   */
  const prevDate = shift === 'A' ? dayjs(date).subtract(1, 'day') : dayjs(date);
  const prevShift: 'A' | 'B' = shift === 'A' ? 'B' : 'A';

  const [selDate, setSelDate] = useState<Dayjs>(prevDate);
  const [selShift, setSelShift] = useState<'A' | 'B'>(prevShift);
  const [qty, setQty] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 이미 확정된 기록. 있으면 조용히 재마감하지 않고 명시적 확인을 받는다. */
  const [existing, setExisting] = useState<{ output_qty: number } | null>(null);
  const [overwriteAck, setOverwriteAck] = useState(false);

  const dateStr = selDate.format('YYYY-MM-DD');

  // 선택한 교대에 이미 확정 기록이 있는지 확인한다. 있으면 재마감이 되므로 경고한다 —
  // 조용히 덮어쓰면 확정된 수량이 소리 없이 바뀐다.
  useEffect(() => {
    let cancelled = false;
    setExisting(null);
    setOverwriteAck(false);
    (async () => {
      try {
        const res = await authFetch(
          `/api/production-records?machine_id=${machineId}&startDate=${dateStr}&endDate=${dateStr}`,
          { cache: 'no-store' }
        );
        if (!res.ok || cancelled) return;
        const body = await res.json() as {
          records?: { shift: string; output_qty: number }[];
        };
        if (cancelled) return;
        const hit = (body.records ?? []).find(r => r.shift === selShift);
        setExisting(hit ? { output_qty: hit.output_qty } : null);
      } catch {
        // 확인 실패는 막지 않는다 — 서버가 재마감 규칙(확정 불량 보존 등)을 최종 집행한다.
      }
    })();
    return () => { cancelled = true; };
  }, [machineId, dateStr, selShift]);

  const submit = useCallback(async () => {
    if (qty === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch('/api/production-records/close-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_id: machineId,
          date: dateStr,
          shift: selShift,
          final_qty: qty,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        // 이른 마감(현재·미래 교대)은 사용자가 고칠 수 있는 상황이므로 구체적으로 알린다.
        setError(
          body?.error?.includes('still open')
            ? t('operator.manualCloseTooEarly')
            : t('operator.closeShiftFailed')
        );
        return;
      }

      setQty(null);
      onClosed();
    } catch {
      setError(t('operator.closeShiftFailed'));
    } finally {
      setSaving(false);
    }
  }, [machineId, dateStr, selShift, qty, onClosed, t]);

  const blockedByExisting = existing !== null && !overwriteAck;

  return (
    <Collapse
      size="small"
      style={{ marginTop: 16 }}
      items={[{
        key: 'manual-close',
        label: (
          <Text strong>
            <EditOutlined /> {t('operator.manualCloseTitle')}
          </Text>
        ),
        children: (
          <Card size="small" variant="borderless" styles={{ body: { padding: 0 } }}>
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('operator.manualCloseHint')}
              </Text>

              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Text style={{ fontSize: 12 }}>{t('operator.manualCloseDate')}</Text>
                <DatePicker
                  value={selDate}
                  onChange={(d) => d && setSelDate(d)}
                  allowClear={false}
                  format="YYYY-MM-DD"
                  style={{ width: '100%' }}
                  // 미래 업무일은 애초에 고를 수 없게 한다(서버도 거부하지만, 고를 수 있게
                  // 두면 왜 실패하는지 알기 어렵다).
                  disabledDate={(d) => d.isAfter(dayjs(), 'day')}
                />
              </Space>

              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Text style={{ fontSize: 12 }}>{t('operator.manualCloseShift')}</Text>
                <Segmented
                  block
                  value={selShift}
                  onChange={(v) => setSelShift(v as 'A' | 'B')}
                  options={[
                    { label: t('operator.shiftA'), value: 'A' },
                    { label: t('operator.shiftB'), value: 'B' },
                  ]}
                />
              </Space>

              {existing !== null && (
                <Alert
                  type="warning"
                  showIcon
                  message={t('operator.manualCloseAlreadyClosed', { qty: existing.output_qty })}
                  description={t('operator.manualCloseAlreadyClosedHint')}
                  action={
                    !overwriteAck ? (
                      <Button size="small" danger onClick={() => setOverwriteAck(true)}>
                        {t('operator.manualCloseOverwrite')}
                      </Button>
                    ) : undefined
                  }
                />
              )}

              <InputNumber
                value={qty}
                onChange={setQty}
                min={0}
                step={1}
                precision={0}
                style={{ width: '100%', fontSize: 20 }}
                size="large"
                placeholder={t('operator.closeShiftFinalQty')}
              />

              <Button
                type="primary"
                block
                size="large"
                loading={saving}
                disabled={qty === null || blockedByExisting}
                onClick={submit}
              >
                {t('operator.closeShiftButton')}
              </Button>

              {error && <Alert type="error" showIcon message={error} />}
            </Space>
          </Card>
        ),
      }]}
    />
  );
};
