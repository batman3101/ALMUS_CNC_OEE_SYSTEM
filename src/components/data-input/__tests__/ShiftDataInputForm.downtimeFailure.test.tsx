/**
 * ShiftDataInputForm - 비가동 조회가 실패했을 때 (#1)
 *
 * 왜 이 테스트가 중요한가:
 *   비가동 조회가 실패하면 화면의 비가동 합계가 조용히 0분이 된다. 그 0분은 저장 흐름에서
 *   "무중단 확인" 모달을 거쳐 downtime_confirmed=true 로 전송되고, 서버는 이를 작업자가
 *   확인한 무중단으로 받아들여 actual_runtime = planned_runtime (가동률 100%) 으로 저장한다.
 *   조회가 실패했을 뿐인데 이미 입력해 둔 비가동이 0으로 덮이는 것이다.
 *
 *   즉 "미입력과 확인된 0분을 구분"하려고 넣은 확인 모달이, 조회 실패한 0분을
 *   "확인된 0분" 으로 승격시켜 오히려 안전장치를 무력화했다.
 *
 * 이 경로는 로그인된 화면에서만 실행되므로 브라우저로 확인하지 못했다. 여기서 실행 검증한다.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from 'antd';
import ShiftDataInputForm from '../ShiftDataInputForm';

const MACHINE = { id: 'machine-1', name: 'CNC-001', location: 'A동', production_model_id: null, current_process_id: null };

jest.mock('@/hooks/useMachines', () => ({
  useMachines: () => ({ machines: [MACHINE], loading: false, error: null })
}));

jest.mock('@/hooks/useUserProfiles', () => ({
  useUserProfiles: () => ({ profiles: [], loading: false })
}));

jest.mock('@/hooks/useSystemSettings', () => ({
  useSystemSettings: () => ({ getShiftTimes: () => ({ breakTime: 60 }) })
}));

// 번역은 키를 그대로 돌려준다 (문구가 아니라 동작을 검증한다)
jest.mock('@/hooks/useTranslation', () => ({
  useDataInputTranslation: () => ({ t: (key: string) => key })
}));

jest.mock('@/utils/machineLocation', () => ({
  formatMachineLocation: (loc: string) => loc
}));

const renderForm = () =>
  render(
    <App>
      <ShiftDataInputForm initialDate="2026-07-14" />
    </App>
  );

/** 설비를 선택해 폼을 연다 (antd Select).
 *  Option 의 children 이 JSX 라 title 속성이 붙지 않으므로 옵션 요소를 직접 클릭한다. */
const selectMachine = async () => {
  const select = document.querySelector('.ant-select-selector');
  fireEvent.mouseDown(select!);

  await waitFor(() => {
    expect(document.querySelector('.ant-select-item-option')).toBeTruthy();
  });

  fireEvent.click(document.querySelector('.ant-select-item-option')!);

  // 설비를 고르면 교대별 입력 카드가 열린다
  await waitFor(() => {
    expect(screen.getByText('dataEntry.shiftDataInput')).toBeTruthy();
  });
};

/** 저장 요청이 전송되었는지 */
const savePosted = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.some(
    ([url, init]) => String(url).includes('/api/production-records/daily') && init?.method === 'POST'
  );

describe('ShiftDataInputForm - 비가동 조회 실패 (#1)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    fetchMock = jest.fn(async (url: string) => {
      // 이미 저장된 기록이 있다 -> shouldSubmitShift 가 true 가 되어 재제출 대상이 된다
      if (url.startsWith('/api/production-records?')) {
        return {
          ok: true,
          json: async () => ({
            records: [
              {
                record_id: 'rec-1',
                machine_id: MACHINE.id,
                date: '2026-07-14',
                shift: 'A',
                output_qty: 100,
                defect_qty: 2,
                planned_runtime: 660
              }
            ]
          })
        };
      }

      // 비가동 조회는 실패한다 (이것이 이 테스트의 전제)
      if (url.startsWith('/api/downtime-entries?')) {
        return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      }

      if (url.startsWith('/api/production-records/daily')) {
        return { ok: true, json: async () => ({ success: true, records_saved: 1 }) };
      }

      return { ok: true, json: async () => ({ success: true }) };
    });

    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('조회 실패를 화면에 드러낸다 (조용히 0분으로 넘어가지 않는다)', async () => {
    renderForm();
    await selectMachine();

    // 실패 경고가 떠야 한다
    await waitFor(() => {
      expect(screen.getAllByText('downtime.loadFailedTitle').length).toBeGreaterThan(0);
    });
  });

  it('조회에 실패한 교대는 저장을 차단한다 (기존 비가동이 0으로 덮이는 것을 막는다)', async () => {
    renderForm();
    await selectMachine();

    await waitFor(() => {
      expect(screen.getAllByText('downtime.loadFailedTitle').length).toBeGreaterThan(0);
    });

    // 저장 시도
    // 기존 기록이 있으므로 버튼 라벨은 editMode.updateData 다
    const saveButton = screen.getByText('editMode.updateData').closest('button');
    fireEvent.click(saveButton!);

    // 저장 요청이 나가면 안 된다
    await waitFor(() => {
      expect(savePosted(fetchMock)).toBe(false);
    });

    // 무중단 확인 모달도 뜨면 안 된다 (실패한 0분을 "확인된 0분"으로 승격시키는 경로)
    expect(screen.queryByText('downtime.confirmZeroTitle')).toBeNull();
  });

  it('조회에 성공하면 저장이 정상 진행된다 (차단이 과하게 걸리지 않는다)', async () => {
    // 이번에는 비가동 조회가 성공한다 (비가동 30분)
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/production-records?')) {
        return {
          ok: true,
          json: async () => ({
            records: [
              {
                record_id: 'rec-1',
                machine_id: MACHINE.id,
                date: '2026-07-14',
                shift: 'A',
                output_qty: 100,
                defect_qty: 2,
                planned_runtime: 660
              }
            ]
          })
        };
      }
      if (url.startsWith('/api/downtime-entries?')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [{ id: 'dt-1', duration_minutes: 30, reason: 'equipmentFailure', start_time: '2026-07-14T01:00:00Z' }]
          })
        };
      }
      if (url.startsWith('/api/production-records/daily')) {
        return { ok: true, json: async () => ({ success: true, records_saved: 1, message: 'ok' }) };
      }
      return { ok: true, json: async () => ({ success: true }) };
    });

    renderForm();
    await selectMachine();

    // 실패 경고가 없어야 한다
    await waitFor(() => {
      expect(screen.queryByText('downtime.loadFailedTitle')).toBeNull();
    });

    // 기존 기록이 있으므로 버튼 라벨은 editMode.updateData 다
    const saveButton = screen.getByText('editMode.updateData').closest('button');
    fireEvent.click(saveButton!);

    // 비가동이 30분이므로 무중단 확인 모달 없이 바로 저장된다
    await waitFor(() => {
      expect(savePosted(fetchMock)).toBe(true);
    });
  });
});
