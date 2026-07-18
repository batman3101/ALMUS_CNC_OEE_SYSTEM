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
  const closePending = backlog.closePending.find(p => !(p.date === date && p.shift === shift)) ?? null;
  const defectPending = backlog.defectPending[0] ?? null;

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
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

      <Card size="small" title={t('operator.reportProgress')}>
        <ProgressInputSection
          machineId={machineId}
          date={date}
          shift={shift}
          lastReportedQty={progress.lastReportedQty}
          downtimeSince={downtimeSince}
          onSaved={progress.refresh}
        />
      </Card>

      <Card size="small" title={t('operator.downtime')}>
        <DowntimeAndonSection
          machineId={machineId}
          currentState={currentState}
          onChanged={() => { progress.refresh(); backlog.refresh(); }}
        />
      </Card>

      <CloseShiftSection
        machineId={machineId}
        pendingShift={closePending}
        prefillQty={null}
        onClosed={() => backlog.refresh()}
      />

      <DefectPendingSection
        item={defectPending}
        onConfirmed={() => backlog.refresh()}
      />
    </Space>
  );
};
