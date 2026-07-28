'use client';

import React, { useMemo, useState } from 'react';
import { Card, Space } from 'antd';
import { OEEGauge } from '@/components/oee';
import type { MachineState, OEEMetrics } from '@/types';
import { useRealtimeProgress } from '@/hooks/useRealtimeProgress';
import { useShiftBacklog } from '@/hooks/useShiftBacklog';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { calculateRealtimeProgress } from '@/utils/realtimeProgress';
import { useMachinesTranslation } from '@/hooks/useTranslation';
import { ProgressInputSection } from './ProgressInputSection';
import { DowntimeAndonSection } from './DowntimeAndonSection';
import { CloseShiftSection } from './CloseShiftSection';
import { DefectPendingSection } from './DefectPendingSection';
import { DowntimeBreakdownCard } from '@/components/downtime';

interface Props {
  machineId: string;
  machineName: string;
  currentState: MachineState;
  /** 열린 비가동 시작 시각(ISO) — 진척 입력 잠금용. */
  downtimeSince: string | null;
  date: string;
  shift: 'A' | 'B';
  /** 확정 OEE 스냅샷(있으면 게이지). 없으면 미보고 → 게이지 없음. */
  confirmedMetrics: OEEMetrics | null;
}

/**
 * 선택 설비의 통합 콘솔. 실시간 지표(가동×성능·진척·경과율) + 진척 인라인 + andon 비가동 +
 * 지난교대 마감 + 다음날 불량을 한 곳에. 데이터(진척·백로그)는 이 컴포넌트가 소유하고 주기 갱신한다.
 */
export const MachineConsole: React.FC<Props> = ({
  machineId, machineName, currentState, downtimeSince, date, shift, confirmedMetrics,
}) => {
  const { t } = useMachinesTranslation();
  const [now, setNow] = useState<Date>(() => new Date());
  // andon 이 비가동을 시작/재개하면 이 값을 올려 비가동 카드에 재조회를 알린다.
  const [downtimeRefreshToken, setDowntimeRefreshToken] = useState(0);
  const progress = useRealtimeProgress({ machineId, date, shift });
  const backlog = useShiftBacklog(machineId);

  useAutoRefresh(() => {
    setNow(new Date());
    progress.refresh();
    backlog.refresh();
  }, true);

  // 교대 창은 서버값(progress). 720 모델이 아니면 fail-closed.
  const shiftModelSupported = progress.operatingMinutes === 720;
  const realtime = useMemo(() => {
    if (
      progress.downtimeMinutes === null || progress.tactTimeSeconds === null ||
      progress.operatingMinutes === null || progress.shiftStart === null
    ) return null;
    if (!progress.breakConfigMatches || !shiftModelSupported) return null;
    return calculateRealtimeProgress({
      shift,
      shiftStart: new Date(progress.shiftStart),
      now,
      operatingMinutes: progress.operatingMinutes,
      tactTimeSeconds: progress.tactTimeSeconds,
      downtimeMinutes: progress.downtimeMinutes,
      shiftOutputQty: progress.lastReportedQty,
    });
  }, [
    progress.downtimeMinutes, progress.tactTimeSeconds, progress.lastReportedQty,
    progress.breakConfigMatches, progress.operatingMinutes, progress.shiftStart,
    shift, now, shiftModelSupported,
  ]);

  // 마감대기에서 현재 진행 중인 교대는 제외한다 — 교대가 끝나기 전에 "마감"하면 안 된다.
  // (진척은 있고 record 는 없어서 백로그엔 들지만, 지금 교대는 아직 마감 대상이 아니다.)
  // 다건이면 전부 넘긴다 — 건수 배지·선택 UI 는 CloseShiftSection 이 담당(코드맵 피드백).
  const closePendingList = backlog.closePending.filter(p => !(p.date === date && p.shift === shift));
  const defectPending = backlog.defectPending[0] ?? null;

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Card
        size="small"
        title={t('operator.reportProgress')}
        style={{ position: 'sticky', top: 0, zIndex: 3, borderColor: '#1677ff' }}
      >
        <ProgressInputSection
          // 컨텍스트가 바뀌면 리마운트 — 미저장 입력값(qty)이 다른 설비/교대로 넘어가는 것을 차단.
          // (lastReportedQty 가 양쪽 다 null 이면 prop 기반 effect 는 발화하지 않아 값이 잔존했다)
          key={`${machineId}:${date}:${shift}`}
          machineId={machineId}
          date={date}
          shift={shift}
          lastReportedQty={progress.lastReportedQty}
          downtimeSince={downtimeSince}
          onSaved={progress.refresh}
        />
      </Card>

      {confirmedMetrics && (
        <Card size="small">
          <OEEGauge metrics={confirmedMetrics} title={machineName} size="small" showDetails={true} />
        </Card>
      )}

      {realtime && (
        <Card size="small">
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              {t('operator.realtimeAvailabilityTimesPerformance')}:{' '}
              <strong>
                {realtime.availabilityTimesPerformance === null ? '—' : `${(realtime.availabilityTimesPerformance * 100).toFixed(1)}%`}
              </strong>
            </div>
            <div>
              {t('operator.shiftProgress')}: <strong>{realtime.progressQty ?? '—'} / {realtime.capaQty ?? '—'}</strong>
            </div>
            <div>
              {t('operator.elapsedRatio')}:{' '}
              <strong>{realtime.elapsedRatio === null ? '—' : `${(realtime.elapsedRatio * 100).toFixed(0)}%`}</strong>
            </div>
          </Space>
        </Card>
      )}

      <Card size="small" title={t('operator.downtime')}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {/* 읽기(경과·누적·사유 목록 + 정정). 업무일은 이 컴포넌트가 소유한 값을 그대로 넘긴다.
              진행 중 비가동은 카드가 조회한 데이터에서 스스로 알아내므로 상태를 넘기지 않는다. */}
          <DowntimeBreakdownCard
            machineId={machineId}
            date={date}
            allowCorrection
            refreshToken={downtimeRefreshToken}
            onCorrected={() => { progress.refresh(); backlog.refresh(); }}
          />
          {/* 상태 전이 쓰기(비가동 시작 / 가동 재개)는 별개 책임으로 남긴다.
              두 컴포넌트는 형제라 서로를 모른다 — andon 이 상태를 바꾸면 여기서
              토큰을 올려 카드에 재조회를 알린다. 안 그러면 "비가동 중" 배너 옆에서
              누적이 그대로 남는다(2026-07-28 브라우저 확인). */}
          <DowntimeAndonSection
            machineId={machineId}
            currentState={currentState}
            onChanged={() => {
              progress.refresh();
              backlog.refresh();
              setDowntimeRefreshToken(token => token + 1);
            }}
          />
        </Space>
      </Card>

      <CloseShiftSection
        // 설비 전환 시 내부 선택·입력 상태 초기화 (ProgressInputSection 과 동일 교훈).
        key={machineId}
        machineId={machineId}
        // prefill 은 각 항목의 last_qty(그 교대의 마지막 진척값) — 현재 교대의
        // progress.lastReportedQty 를 쓰면 안 된다(다른 교대의 값).
        pendingShifts={closePendingList}
        onClosed={() => backlog.refresh()}
      />

      <DefectPendingSection
        item={defectPending}
        onConfirmed={() => backlog.refresh()}
      />
    </Space>
  );
};
