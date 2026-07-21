'use client';

import React, { useEffect, useState } from 'react';
import { Card, InputNumber, Button, Space, Typography, Alert } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { authFetch } from '@/lib/authFetch';
import { useMachinesTranslation } from '@/hooks/useTranslation';

const { Text } = Typography;

interface Props {
  machineId: string;
  /** 마감 대기 교대. 없으면 렌더하지 않는다. */
  pendingShift: { date: string; shift: 'A' | 'B' } | null;
  /** 그 교대의 마지막 진척값(있으면 prefill). 없으면 null(종이값 직접 입력). */
  prefillQty: number | null;
  onClosed: () => void;
}

/**
 * 지난 교대 마감(늦은 입력). 진척값이 있으면 prefill 되어 원탭 확정, 없으면 종이 카운트 직접 입력.
 * 마감 시 close-shift 로 output 확정(defect 는 NULL, 다음날). 귀속은 pendingShift.date/shift.
 */
export const CloseShiftSection: React.FC<Props> = ({ machineId, pendingShift, prefillQty, onClosed }) => {
  const { t } = useMachinesTranslation();
  const [qty, setQty] = useState<number | null>(prefillQty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQty(prefillQty);
    setError(null);
  }, [pendingShift?.date, pendingShift?.shift, prefillQty]);

  if (!pendingShift) return null;

  const submit = async () => {
    if (qty === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch('/api/production-records/close-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine_id: machineId, date: pendingShift.date, shift: pendingShift.shift, final_qty: qty }),
      });
      if (!res.ok) { setError(t('operator.closeShiftFailed')); return; }
      onClosed();
    } catch {
      setError(t('operator.closeShiftFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card size="small" style={{ marginTop: 16, borderColor: '#e0785a' }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Text strong style={{ color: '#e0785a' }}>
          <ClockCircleOutlined /> {t('operator.closeShiftTitle', { date: pendingShift.date, shift: pendingShift.shift })}
        </Text>
        <InputNumber
          value={qty}
          onChange={setQty}
          min={0}
          step={1}
          style={{ width: '100%', fontSize: 20 }}
          size="large"
          placeholder={t('operator.closeShiftFinalQty')}
        />
        <Button type="primary" block size="large" loading={saving} disabled={qty === null} onClick={submit}>
          {t('operator.closeShiftButton')}
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>{t('operator.closeShiftHint')}</Text>
        {error && <Alert type="error" showIcon message={error} />}
      </Space>
    </Card>
  );
};
