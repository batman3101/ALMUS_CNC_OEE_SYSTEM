'use client';

import React, { useState } from 'react';
import { Button, Alert, Modal } from 'antd';
import { PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useMachineDowntime } from '@/hooks/useMachineDowntime';
import { useMachinesTranslation } from '@/hooks/useTranslation';
import type { MachineState } from '@/types';

// machine_status ENUM 의 비정상 값(NORMAL 제외). andon 사유 = 이 8개.
const REASONS: MachineState[] = [
  'INSPECTION', 'BREAKDOWN_REPAIR', 'PM_MAINTENANCE', 'MODEL_CHANGE',
  'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP',
];

interface Props {
  machineId: string;
  currentState: MachineState;
  /** 성공 시 실시간 데이터·백로그 새로고침 */
  onChanged: () => void;
}

/**
 * andon 비가동 한 동작. 정상이면 "비가동 시작 → 사유 선택", 비가동이면 "가동 재개".
 * 한 번의 호출이 machine_logs + downtime_entries 를 함께 기록한다(서버 RPC).
 */
export const DowntimeAndonSection: React.FC<Props> = ({ machineId, currentState, onChanged }) => {
  const { t } = useMachinesTranslation();
  const { start, resume, busy } = useMachineDowntime(machineId, onChanged);
  const [pickerOpen, setPickerOpen] = useState(false);
  const down = currentState !== 'NORMAL_OPERATION';

  return (
    <div>
      {down ? (
        <>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 8 }}
            message={`${t('operator.downtimeNow')} · ${t(`states.${currentState}`)}`}
          />
          <Button block size="large" icon={<PlayCircleOutlined />} loading={busy} onClick={() => resume()}>
            {t('operator.resumeOperation')}
          </Button>
        </>
      ) : (
        <Button block size="large" danger icon={<PauseCircleOutlined />} loading={busy} onClick={() => setPickerOpen(true)}>
          {t('operator.startDowntime')}
        </Button>
      )}

      <Modal open={pickerOpen} title={t('operator.selectReason')} footer={null} onCancel={() => setPickerOpen(false)}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {REASONS.map(r => (
            <Button
              key={r}
              size="large"
              style={{ height: 56 }}
              onClick={async () => { setPickerOpen(false); await start(r); }}
            >
              {t(`states.${r}`)}
            </Button>
          ))}
        </div>
      </Modal>
    </div>
  );
};
