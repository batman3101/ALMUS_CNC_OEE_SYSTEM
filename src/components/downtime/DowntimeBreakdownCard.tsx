'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Modal, Space, Typography } from 'antd';
import { useDowntimeBreakdown } from '@/hooks/useDowntimeBreakdown';
import { useMultipleTranslation } from '@/hooks/useTranslation';
import { resolveDowntimeReasonLabel } from '@/utils/downtimeReasonLabel';
import { authFetch } from '@/lib/authFetch';
import type { DowntimeBreakdownRow } from '@/utils/downtimeBreakdown';
import type { MachineState } from '@/types';

const { Text } = Typography;

/** 진행 중 경과 표시 갱신 주기. 분 단위 표시라 10초면 충분하고 렌더도 아깝지 않다. */
const TICK_MS = 10_000;

// machine_status ENUM 의 비정상 값(NORMAL 제외). DowntimeAndonSection 과 같은 8개다.
const REASONS: MachineState[] = [
  'INSPECTION', 'BREAKDOWN_REPAIR', 'PM_MAINTENANCE', 'MODEL_CHANGE',
  'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP',
];

export interface DowntimeBreakdownCardProps {
  machineId: string;
  /**
   * 업무일을 **반드시 주입한다**. 컴포넌트가 "오늘"을 스스로 추측하면 두 화면이
   * 서로 다른 창을 볼 수 있다 — 이 프로젝트가 이미 겪은 실패 유형이다.
   */
  date: string;
  onCorrected: () => void;
  /** 기본 false. 운영자 콘솔만 true. */
  allowCorrection?: boolean;
  /**
   * 값이 바뀌면 재조회한다. andon 으로 비가동을 시작/재개했을 때 상위가 올린다.
   *
   * 이 카드와 DowntimeAndonSection 은 **형제**라 서로를 모르고, 이 카드의 훅에는 자체
   * 폴링이 없다(마운트·인자 변경 시에만 조회). 그래서 andon 으로 비가동을 시작해도
   * 카드가 그대로 남아 "비가동 중" 배너 옆에서 누적이 안 변하는 상태가 됐다
   * (2026-07-28 브라우저 확인). 상위가 명시적으로 알려 주는 것이 유일한 경로다.
   */
  refreshToken?: number;
}

const formatClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

const formatDuration = (
  minutesTotal: number,
  t: (key: string, options?: Record<string, unknown>) => string
): string => {
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  if (hours > 0) return t('detail.durationHM', { hours, minutes });
  return t('downtimeBreakdown.minutesShort', { minutes });
};

/**
 * 이 교대의 비가동을 한 자리에 보여준다: 진행 중 경과 + 누적 + 건별 사유 목록.
 *
 * 상태 전이 쓰기(비가동 시작 / 가동 재개)는 이 컴포넌트의 책임이 아니다 —
 * DowntimeAndonSection 이 담당한다. 여기는 읽기와 사유 정정만 한다.
 */
export const DowntimeBreakdownCard: React.FC<DowntimeBreakdownCardProps> = ({
  machineId, date,
  onCorrected,
  allowCorrection = false,
  refreshToken,
}) => {
  const { t } = useMultipleTranslation(['machines', 'dataInput']);
  const { totalMinutes, shiftTotals, ongoingSince, intervals, loaded, error, refresh } =
    useDowntimeBreakdown({ machineId, date });

  // 마운트 조회는 훅이 이미 한다. 여기서는 **토큰이 바뀐 뒤**부터만 재조회한다.
  const skipFirstTokenRef = useRef(true);
  useEffect(() => {
    if (skipFirstTokenRef.current) { skipFirstTokenRef.current = false; return; }
    refresh();
    // refreshToken 이 바뀔 때만 재조회한다. refresh 를 deps 에 넣으면 machineId/date 변경 시
    // 훅의 자체 재조회와 겹쳐 같은 요청을 두 번 보낸다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // 진행 중 비가동은 조회한 데이터가 알려준다 — 설비 상태를 prop 으로 따로 받지 않는다.
  // (Machine 타입에는 비가동 시작 시각 필드가 없고, 두 소스를 두면 화면끼리 어긋난다.)
  const ongoingRow = intervals.find(row => row.end === null) ?? null;

  const [correcting, setCorrecting] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitCorrection = useCallback(async (reason: MachineState) => {
    setBusy(true);
    setCorrectError(null);
    try {
      const res = await authFetch(`/api/machines/${machineId}/downtime`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        // 409 = 이미 가동 재개됨. 일반 실패와 다른 안내가 필요하다.
        setCorrectError(
          res.status === 409
            ? t('downtimeBreakdown.correctNotInDowntime')
            : t('downtimeBreakdown.correctFailed')
        );
        return;
      }
      setCorrecting(false);
      refresh();
      onCorrected();
    } catch {
      setCorrectError(t('downtimeBreakdown.correctFailed'));
    } finally {
      setBusy(false);
    }
  }, [machineId, onCorrected, refresh, t]);
  // 경과는 **클립되지 않은** ongoingSince 로 잰다. ongoingRow.start 는 교대 시작으로
  // 잘려 있어서, 이전 교대에서 이어진 비가동의 경과가 실제보다 짧게 나온다.
  const elapsedMinutes = ongoingSince
    ? Math.max(0, Math.floor((now - Date.parse(ongoingSince)) / 60000))
    : null;

  const renderRow = (row: DowntimeBreakdownRow) => (
    <div
      key={row.id}
      style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0' }}
    >
      <Text type="secondary" style={{ minWidth: 108, fontVariantNumeric: 'tabular-nums' }}>
        {row.clipped_start ? '‹' : ''}{formatClock(row.start)}
        {'~'}
        {row.end === null ? t('downtimeBreakdown.ongoing') : formatClock(row.end)}
      </Text>
      <Text strong style={{ minWidth: 56, fontVariantNumeric: 'tabular-nums' }}>
        {t('downtimeBreakdown.minutesShort', { minutes: row.minutes })}
      </Text>
      <Text>{resolveDowntimeReasonLabel(row.reason, t)}</Text>
      {row.end === null && allowCorrection && (
        <Button size="small" type="link" onClick={() => { setCorrectError(null); setCorrecting(true); }}>
          {t('downtimeBreakdown.correct')}
        </Button>
      )}
    </div>
  );

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      {ongoingSince !== null && elapsedMinutes !== null && (
        <Alert
          type="warning"
          showIcon
          message={t('downtimeBreakdown.elapsedNow', {
            reason: resolveDowntimeReasonLabel(ongoingRow?.reason ?? '', t),
            duration: formatDuration(elapsedMinutes, t),
          })}
          description={t('downtimeBreakdown.since', { time: formatClock(ongoingSince) })}
        />
      )}

      {/* 누적. null 은 "0분"이 아니라 "모름"이다 — 섞으면 멈춘 설비가 멀쩡해 보인다.
          단 null 에는 세 가지 뜻이 겹쳐 있다: 아직 조회 전 / 조회 실패 / 계획정지·휴식
          겹침으로 계산 보류. loaded 로 갈라야 한다. 안 그러면 로딩 중에 "계획정지 때문"
          이라는 **있지도 않은 이유**를 단정해 알리게 된다(2026-07-28 브라우저에서 실제 발생). */}
      {totalMinutes === null ? (
        <Text type="secondary">
          {t('downtimeBreakdown.cumulativeUnknown')}
          {loaded && ` · ${t('downtimeBreakdown.cumulativeUnknownHint')}`}
        </Text>
      ) : (
        <Text>
          {t('downtimeBreakdown.cumulative', {
            count: intervals.length,
            // 표시할 때 정수로 맞춘다. 서버의 total_minutes 는 소수 2자리를 유지하는데
            // (확정 OEE 와 같은 함수의 산출물이라 정밀도를 깎지 않는다), 그대로 그리면
            // 건별 행은 120분인데 누적은 119.64분으로 보인다 — 같은 시간이 두 숫자로
            // 나타나 사용자가 계산 오류로 읽는다. 행(Math.round)과 같은 규칙으로 맞춘다.
            minutes: Math.round(totalMinutes),
          })}
        </Text>
      )}

      {/* 주간/야간 소계. 라벨에 A/B 글자를 쓰지 않는다 — 이 시스템의 A/B 는 시간대이지
          근무조가 아닌데, 현장은 조 이름으로 읽는다. 시각은 서버가 내려준 start/end 를
          그대로 쓴다(설정값이라 하드코딩하지 않는다). null 소계는 "모름"이라 대시로 그린다. */}
      {shiftTotals !== null && (
        <Text type="secondary">
          {t('downtimeBreakdown.shiftTotalDay', {
            from: formatClock(shiftTotals.day.start),
            to: formatClock(shiftTotals.day.end),
            minutes: shiftTotals.day.minutes === null
              ? '—'
              : t('downtimeBreakdown.minutesShort', { minutes: Math.round(shiftTotals.day.minutes) }),
          })}
          {' · '}
          {t('downtimeBreakdown.shiftTotalNight', {
            from: formatClock(shiftTotals.night.start),
            to: formatClock(shiftTotals.night.end),
            minutes: shiftTotals.night.minutes === null
              ? '—'
              : t('downtimeBreakdown.minutesShort', { minutes: Math.round(shiftTotals.night.minutes) }),
          })}
        </Text>
      )}

      {/* 조회 실패는 "0건"과 다르다. loaded 로 구분한다. */}
      {!loaded && error && (
        <Alert
          type="error"
          showIcon
          message={t('downtimeBreakdown.loadFailed')}
          action={<Button size="small" onClick={refresh}>{t('downtimeBreakdown.retry')}</Button>}
        />
      )}

      {loaded && intervals.length === 0 && (
        <Text type="secondary">{t('downtimeBreakdown.empty')}</Text>
      )}

      {loaded && intervals.length > 0 && (
        <Collapse
          ghost
          size="small"
          defaultActiveKey={['list']}
          items={[{
            key: 'list',
            label: t('downtimeBreakdown.toggle', { count: intervals.length }),
            children: <div>{intervals.map(renderRow)}</div>,
          }]}
        />
      )}

      <Modal
        open={correcting}
        title={t('downtimeBreakdown.correctTitle')}
        footer={null}
        onCancel={() => setCorrecting(false)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert type="info" showIcon message={t('downtimeBreakdown.correctHint')} />
          {correctError && <Alert type="error" showIcon message={correctError} />}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {/* 현재 사유는 제외한다 — 같은 사유로 정정하면 RPC 가 no-op 이라 눌러도 아무 일이
                일어나지 않는다. 누를 수 없는 버튼을 보여주지 않는다. */}
            {REASONS.filter(reason => reason !== ongoingRow?.reason).map(reason => (
              <Button
                key={reason}
                size="large"
                style={{ height: 56 }}
                loading={busy}
                onClick={() => void submitCorrection(reason)}
              >
                {resolveDowntimeReasonLabel(reason, t)}
              </Button>
            ))}
          </div>
        </Space>
      </Modal>
    </Space>
  );
};
