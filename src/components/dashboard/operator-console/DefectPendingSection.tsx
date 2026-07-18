'use client';

import React, { useEffect, useState } from 'react';
import { Card, InputNumber, Button, Space, Typography, Alert } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { authFetch } from '@/lib/authFetch';
import { useMachinesTranslation } from '@/hooks/useTranslation';

const { Text } = Typography;

interface Props {
  /** 확정대기(불량 미입력) record. 없으면 렌더하지 않는다. */
  item: { record_id: string; date: string; shift: 'A' | 'B' } | null;
  onConfirmed: () => void;
}

/**
 * 다음날 불량 입력 → 확정. avail·perf 스냅샷은 유지, quality/oee 만 파생 재계산(서버).
 */
export const DefectPendingSection: React.FC<Props> = ({ item, onConfirmed }) => {
  const { t } = useMachinesTranslation();
  const [defect, setDefect] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDefect(null); setError(null); }, [item?.record_id]);

  if (!item) return null;

  const submit = async () => {
    if (defect === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(`/api/production-records/${item.record_id}/defect`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defect_qty: defect }),
      });
      if (!res.ok) { setError(t('operator.defectFailed')); return; }
      onConfirmed();
    } catch {
      setError(t('operator.defectFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card size="small" style={{ marginTop: 16, borderColor: '#78c878' }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Text strong style={{ color: '#52c41a' }}>
          <CheckCircleOutlined /> {t('operator.defectTitle', { date: item.date, shift: item.shift })}
        </Text>
        <InputNumber
          value={defect}
          onChange={setDefect}
          min={0}
          step={1}
          style={{ width: '100%', fontSize: 20 }}
          size="large"
          placeholder={t('operator.defectQtyPlaceholder')}
        />
        <Button type="primary" block size="large" loading={saving} disabled={defect === null} onClick={submit}>
          {t('operator.defectConfirm')}
        </Button>
        {error && <Alert type="error" showIcon message={error} />}
      </Space>
    </Card>
  );
};
