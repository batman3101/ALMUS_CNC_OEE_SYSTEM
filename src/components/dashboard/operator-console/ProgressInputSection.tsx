'use client';

import React, { useEffect, useRef, useState } from 'react';
import { InputNumber, Button, Space, Typography, Alert } from 'antd';
import { authFetch } from '@/lib/authFetch';
import { useProductionTranslation } from '@/hooks/useTranslation';

const { Text } = Typography;

interface Props {
  machineId: string;
  date: string;
  shift: 'A' | 'B';
  lastReportedQty: number | null;
  /** 열린 비가동 시작 시각(ISO). 비가동 중이면 입력 잠금. */
  downtimeSince: string | null;
  onSaved: () => void;
}

/**
 * 콘솔 상주 인라인 진척 입력(모달 아님). 값의 의미는 "이 교대 누적 생산량". 비가동 중이면 잠금.
 * 감소(409)·비가동(409 machine_in_downtime)·실패를 구분해 안내한다(ProgressInputModal 과 동일 규율).
 */
export const ProgressInputSection: React.FC<Props> = ({ machineId, date, shift, lastReportedQty, downtimeSince, onSaved }) => {
  const { t } = useProductionTranslation();
  const [qty, setQty] = useState<number | null>(lastReportedQty);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const edited = useRef(false);
  const locked = downtimeSince !== null;

  // 손대지 않은 입력칸만 최신 보고값을 따라간다(작업자가 친 숫자를 폴링이 덮지 않게).
  useEffect(() => { if (!edited.current) setQty(lastReportedQty); }, [lastReportedQty]);
  // 설비/일자/교대가 바뀌면 편집 플래그·오류 초기화.
  useEffect(() => { edited.current = false; setError(null); }, [machineId, date, shift]);

  const submit = async () => {
    if (qty === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch('/api/production-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine_id: machineId, date, shift, shift_output_qty: qty }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as { error?: unknown; last_reported_qty?: unknown };
        if (body.error === 'machine_in_downtime') { setError(t('progressInput.downtimeServerRejected')); return; }
        if (typeof body.last_reported_qty === 'number') { setError(t('progressInput.decreasedError', { last: body.last_reported_qty })); return; }
      }
      if (!res.ok) { setError(t('progressInput.saveFailed')); return; }
      edited.current = false;
      onSaved();
    } catch {
      setError(t('progressInput.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (locked) {
    return (
      <Alert
        type="warning"
        showIcon
        message={t('progressInput.downtimeLocked', { since: new Date(downtimeSince).toLocaleString() })}
      />
    );
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Text>{t('progressInput.label')}</Text>
      <InputNumber
        value={qty}
        onChange={(v) => { edited.current = true; setQty(v); }}
        min={0}
        step={1}
        size="large"
        style={{ width: '100%', fontSize: 24 }}
      />
      <Button type="primary" block size="large" loading={saving} disabled={qty === null} onClick={submit}>
        {t('progressInput.submit')}
      </Button>
      <Text type="secondary" style={{ fontSize: 12 }}>{t('progressInput.hint')}</Text>
      {error && <Alert type="error" showIcon message={error} />}
    </Space>
  );
};
