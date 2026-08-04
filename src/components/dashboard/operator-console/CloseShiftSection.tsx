'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Card, InputNumber, Input, Button, Space, Typography, Alert, Badge } from 'antd';
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
  /**
   * 진척보다 낮게 마감하려 할 때 뜨는 확인 단계. `null` 이면 평소 화면이다.
   *
   * 서버가 판정한다 — 여기서 미리 비교하지 않는 이유는 진척이 이 화면이 모르는 사이에
   * 늘어날 수 있고, 무엇보다 **판정과 저장이 같은 잠금 아래** 있어야 하기 때문이다.
   */
  const [belowProgress, setBelowProgress] = useState<{ lastQty: number } | null>(null);
  const [reason, setReason] = useState('');
  // 작업자가 수량 칸을 건드렸는지 — 폴링 갱신이 입력값을 덮지 않게 하는 가드
  // (ProgressInputSection 과 동일 교훈).
  const edited = useRef(false);

  // 첫 렌더에서 첫 항목으로 selKey 를 고정한다. 이렇게 하지 않으면 selKey=null 인 채로
  // 30초 폴링이 (미정렬이던) 배열 순서를 바꿀 때 "첫 항목"이 다른 교대가 되어, 입력 중이던
  // 수량이 엉뚱한 교대로 넘어갈 수 있었다(자체 감사 후속 #1). API 정렬과 이중 방어.
  useEffect(() => {
    if (selKey === null && pendingShifts.length > 0) setSelKey(keyOf(pendingShifts[0]));
  }, [selKey, pendingShifts]);

  // 선택 항목이 마감되어 목록에서 사라지면 첫 건으로 되돌아간다.
  const selected = pendingShifts.find(p => keyOf(p) === selKey) ?? pendingShifts[0] ?? null;

  // 선택 교대가 바뀔 때만 그 교대의 진척값으로 prefill 하고 편집 플래그를 리셋한다.
  // 손대지 않은 칸은 last_qty 변화를 따라가되, 작업자가 친 숫자는 폴링이 덮지 않는다.
  const selectedKey = selected ? keyOf(selected) : null;
  useEffect(() => {
    edited.current = false;
    setQty(selected ? selected.last_qty : null);
    setError(null);
  }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!edited.current) setQty(selected ? selected.last_qty : null);
  }, [selected?.last_qty]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selected) return null;

  const submit = async (belowProgressReason?: string) => {
    if (qty === null) return;
    setSaving(true);
    setError(null);
    try {
      const post = () => authFetch('/api/production-records/close-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_id: machineId,
          date: selected.date,
          shift: selected.shift,
          final_qty: qty,
          ...(belowProgressReason ? { below_progress_reason: belowProgressReason } : {}),
        }),
      });

      let res = await post();

      // 지표를 계산하는 사이 비가동이 바뀌면 서버가 저장하지 않고 409(retryable)로 되묻는다.
      // 낡은 값을 확정 저장하지 않기 위한 설계이므로, 여기서 한 번 다시 보내면 서버가 새
      // 원천으로 다시 계산한다. 작업자에게 보이는 것은 아무것도 없다.
      //
      // 한 번만 재시도한다 — 두 번 연속 어긋난다면 누군가 지금 비가동을 계속 고치고 있다는
      // 뜻이고, 그때는 조용히 반복하기보다 실패로 알리는 편이 낫다.
      if (res.status === 409) {
        const body = await res.clone().json().catch(() => null) as {
          retryable?: boolean; error?: string; last_progress_qty?: number;
        } | null;
        if (body?.retryable) res = await post();

        /**
         * 진척보다 낮은 마감이다. 오류가 아니라 **확인이 필요한 상태**다 —
         * 진척 오입력을 종이 카운트로 정정하는 일이 실제로 있어 막지 않기로 했다.
         * 대신 사유를 받아 감사 기록에 남긴다. 사유 없이는 저장되지 않는다.
         */
        if (body?.error === 'below_progress_needs_reason') {
          setBelowProgress({ lastQty: body.last_progress_qty ?? 0 });
          setReason('');
          return;
        }
      }

      if (!res.ok) { setError(t('operator.closeShiftFailed')); return; }
      setBelowProgress(null);
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
          onChange={(v) => { edited.current = true; setQty(v); }}
          min={0}
          step={1}
          style={{ width: '100%', fontSize: 20 }}
          size="large"
          placeholder={t('operator.closeShiftFinalQty')}
        />
        {belowProgress === null ? (
          <>
            <Button
              type="primary"
              block
              size="large"
              loading={saving}
              disabled={qty === null}
              onClick={() => submit()}
            >
              {t('operator.closeShiftButton')}
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('operator.closeShiftHint')}</Text>
          </>
        ) : (
          /*
            진척보다 낮은 마감 — 막지 않고 사유를 받는다.
            현장에서 진척 오입력을 종이 카운트로 정정하는 일이 실제로 있기 때문이다.
            막아 버리면 그 교대가 영원히 마감 불가가 된다. 대신 나중에 되짚을 수 있게
            사유를 감사 기록에 남긴다.
          */
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert
              type="warning"
              showIcon
              message={t('operator.closeBelowProgressTitle', {
                last: belowProgress.lastQty,
                qty,
              })}
              description={t('operator.closeBelowProgressHint')}
            />
            <Input.TextArea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={200}
              showCount
              placeholder={t('operator.closeBelowProgressReasonPlaceholder')}
            />
            <Space style={{ width: '100%' }}>
              <Button
                onClick={() => { setBelowProgress(null); setReason(''); }}
                disabled={saving}
              >
                {t('operator.closeBelowProgressCancel')}
              </Button>
              <Button
                type="primary"
                danger
                loading={saving}
                disabled={reason.trim().length === 0}
                onClick={() => submit(reason.trim())}
              >
                {t('operator.closeBelowProgressConfirm')}
              </Button>
            </Space>
          </Space>
        )}
        {error && <Alert type="error" showIcon message={error} />}
      </Space>
    </Card>
  );
};
