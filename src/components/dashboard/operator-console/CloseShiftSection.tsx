'use client';

import React, { useEffect, useState } from 'react';
import { Card, InputNumber, Button, Space, Typography, Alert, Badge } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { authFetch } from '@/lib/authFetch';
import { useMachinesTranslation } from '@/hooks/useTranslation';
import type { ClosePendingItem } from '@/hooks/useShiftBacklog';

const { Text } = Typography;

interface Props {
  machineId: string;
  /** 마감 대기 교대 목록(현재 교대 제외, 각 항목은 그 교대의 마지막 진척값 last_qty 포함). 비면 렌더하지 않는다. */
  pendingShifts: ClosePendingItem[];
  onClosed: () => void;
}

const keyOf = (p: ClosePendingItem) => `${p.date}|${p.shift}`;

/**
 * 지난 교대 마감(늦은 입력). 대기가 여러 건이면 건수 배지 + 교대 선택 칩으로 대상을 고른다
 * (이전엔 첫 건만 보였다 — 코드맵 피드백). 진척값이 있으면 prefill 되어 원탭 확정,
 * 없으면 종이 카운트 직접 입력. 마감 시 close-shift 로 output 확정(defect 는 NULL, 다음날).
 */
export const CloseShiftSection: React.FC<Props> = ({ machineId, pendingShifts, onClosed }) => {
  const { t } = useMachinesTranslation();
  const [selKey, setSelKey] = useState<string | null>(null);
  const [qty, setQty] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 선택 항목이 마감되어 목록에서 사라지면 첫 건으로 되돌아간다.
  const selected = pendingShifts.find(p => keyOf(p) === selKey) ?? pendingShifts[0] ?? null;

  // 선택이 바뀌면 그 교대의 진척값으로 prefill (설비 전환은 부모의 key 리마운트가 초기화).
  useEffect(() => {
    setQty(selected ? selected.last_qty : null);
    setError(null);
  }, [selected?.date, selected?.shift, selected?.last_qty]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selected) return null;

  const submit = async () => {
    if (qty === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch('/api/production-records/close-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine_id: machineId, date: selected.date, shift: selected.shift, final_qty: qty }),
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
        <Space align="center">
          <Text strong style={{ color: '#e0785a' }}>
            <ClockCircleOutlined /> {t('operator.closeShiftTitle', { date: selected.date, shift: selected.shift })}
          </Text>
          {pendingShifts.length > 1 && (
            <Badge
              count={t('operator.closeShiftBacklogCount', { count: pendingShifts.length })}
              style={{ backgroundColor: '#e0785a' }}
            />
          )}
        </Space>
        {pendingShifts.length > 1 && (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('operator.closeShiftPick')}</Text>
            <Space wrap size={6}>
              {pendingShifts.map(p => (
                <Button
                  key={keyOf(p)}
                  size="small"
                  type={keyOf(p) === keyOf(selected) ? 'primary' : 'default'}
                  onClick={() => setSelKey(keyOf(p))}
                >
                  {p.date.slice(5)} {p.shift}
                </Button>
              ))}
            </Space>
          </Space>
        )}
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
