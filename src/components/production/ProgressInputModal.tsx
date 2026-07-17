'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Modal, InputNumber, Alert, Typography, Space } from 'antd';
import { authFetch } from '@/lib/authFetch';
import { useProductionTranslation } from '@/hooks/useTranslation';

const { Text } = Typography;

interface ProgressInputModalProps {
  open: boolean;
  machineId: string;
  machineName: string;
  date: string;
  shift: 'A' | 'B';
  /** 마지막 보고값. 없으면 null. */
  lastReportedQty: number | null;
  /** 열린 비가동의 시작 시각(ISO). 비가동 중이 아니면 null. */
  downtimeSince: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * 교대 중 진행 보고 입력.
 *
 * 입력값의 의미는 "이 교대에서 지금까지 만든 총 개수"다. 작업자가 그 숫자를 어떻게 얻는지는
 * 규정하지 않는다 — 카운터를 읽든, 뺄셈을 하든, 직접 세든 결과값만 받는다.
 *
 * 비가동 중이면 입력을 잠근다. 안 도는 설비에 생산량을 넣을 수는 없다.
 */
export const ProgressInputModal: React.FC<ProgressInputModalProps> = ({
  open, machineId, machineName, date, shift, lastReportedQty, downtimeSince, onClose, onSaved,
}) => {
  const { t } = useProductionTranslation();
  const [qty, setQty] = useState<number | null>(lastReportedQty);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 이번에 연 뒤로 작업자가 입력칸을 직접 고쳤는지.
  const edited = useRef(false);

  const locked = downtimeSince !== null;

  // Modal 은 닫혀도 언마운트되지 않으므로 useState 초기값은 첫 마운트에서 한 번만 쓰인다.
  // 동기화하지 않으면 재오픈 시 옛 값이 고여 있고, 작업자가 그대로 저장하면 409 를 맞는다.
  // 아직 손대지 않은 입력칸만 최신 보고값을 따라간다 — 작업자가 친 숫자를 폴링이 덮으면
  // 자기가 뭘 눌렀는지 알 수 없게 된다.
  useEffect(() => {
    if (!open) {
      edited.current = false;
      return;
    }
    if (!edited.current) setQty(lastReportedQty);
  }, [open, lastReportedQty]);

  // 지난번에 닫을 때 떠 있던 오류는 이번 입력과 무관하다.
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleChange = (value: number | null) => {
    edited.current = true;
    setQty(value);
  };

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
        const body = (await res.json()) as { last_reported_qty?: unknown };
        // 감소했다고 말하려면 무엇보다 적은지를 알아야 한다. 모르면 아래 일반 실패로 떨어진다.
        if (typeof body.last_reported_qty === 'number') {
          setError(t('progressInput.decreasedError', { last: body.last_reported_qty }));
          return;
        }
      }
      if (!res.ok) {
        // 500·403·400 이 여기로 온다. 이것을 감소라고 말하면 작업자는 맞는 숫자를 의심해
        // 고친다 — 서버 장애를 입력 실수로 진단해 좋은 데이터를 망가뜨리게 만든다.
        setError(t('progressInput.saveFailed'));
        return;
      }
      onSaved();
      onClose();
    } catch {
      // 네트워크 오류는 res.ok 분기까지 오지도 않는다. 잡지 않으면 작업자는 아무 메시지도
      // 못 보고 저장된 줄 안다.
      setError(t('progressInput.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`${machineName} — ${t('progressInput.title')}`}
      onCancel={onClose}
      onOk={submit}
      okText={t('progressInput.submit')}
      okButtonProps={{ disabled: locked || qty === null, loading: saving }}
    >
      {downtimeSince !== null ? (
        <Alert
          type="warning"
          showIcon
          message={t('progressInput.downtimeLocked', {
            since: new Date(downtimeSince).toLocaleString(),
          })}
        />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>{t('progressInput.label')}</Text>
          <InputNumber
            value={qty}
            onChange={handleChange}
            min={0}
            step={1}
            style={{ width: '100%', fontSize: 24 }}
            size="large"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>{t('progressInput.hint')}</Text>
          {error && <Alert type="error" showIcon message={error} />}
        </Space>
      )}
    </Modal>
  );
};
