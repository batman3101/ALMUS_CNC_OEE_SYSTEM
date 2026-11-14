/**
 * ShiftDataInputForm - 일일 저장의 낡은 화면 보호 (감사 2026-11-14 F-02)
 *
 * 화면이 불러온 기존 기록을 지문(expected_records)으로 함께 보내야 서버가 그 사이의 변경을 알아챈다.
 * 서버가 409(record_changed)로 거부하면 입력을 지우지 않고 최신 기록을 다시 불러온다.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from 'antd';
import ShiftDataInputForm from '../ShiftDataInputForm';

jest.setTimeout(15_000);

const MACHINE = { id: 'machine-1', name: 'CNC-001', location: 'A동', production_model_id: null, current_process_id: null };
const MACHINE_2 = { ...MACHINE, id: 'machine-2', name: 'CNC-002' };

jest.mock('@/hooks/useMachines', () => ({
  useMachines: () => ({ machines: [MACHINE, MACHINE_2], loading: false, error: null })
}));

jest.mock('@/hooks/useUserProfiles', () => ({
  useUserProfiles: () => ({ profiles: [], loading: false })
}));

jest.mock('@/hooks/useSystemSettings', () => ({
  useSystemSettings: () => ({
    getShiftTimes: () => ({
      shiftA: { start: '08:00', end: '20:00' },
      shiftB: { start: '20:00', end: '08:00' },
      breakTime: 60
    }),
    getCompanyInfo: () => ({ timezone: 'Asia/Ho_Chi_Minh' })
  })
}));

// 번역은 키를 그대로 돌려준다 (문구가 아니라 동작을 검증한다)
jest.mock('@/hooks/useTranslation', () => ({
  useDataInputTranslation: () => ({ t: (key: string) => key })
}));

jest.mock('@/utils/machineLocation', () => ({
  formatMachineLocation: (loc: string) => loc
}));

jest.mock('@/lib/authFetch', () => ({
  authFetch: (input: string, init?: RequestInit) => fetch(input, init)
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

const RECORD_A = {
  record_id: 'rec-1', machine_id: MACHINE.id, date: '2026-07-14', shift: 'A',
  output_qty: 100, defect_qty: 2, planned_runtime: 660, actual_runtime: 640, ideal_runtime: 200,
  downtime_minutes: 20, tact_time_seconds: 120, availability: 0.9697, performance: 0.3125,
  quality: 0.98, oee: 0.297, factory_id: 'f-1', created_at: '2026-07-14T12:00:00Z',
};

const dailyCalls = (fetchMock: jest.Mock) => fetchMock.mock.calls.filter(
  ([url, init]) => String(url).includes('/api/production-records/daily') && init?.method === 'POST'
);
const listCalls = (fetchMock: jest.Mock) => fetchMock.mock.calls.filter(
  ([url]) => String(url).startsWith('/api/production-records?')
);

describe('ShiftDataInputForm - 일일 저장 동시 변경 보호 (F-02)', () => {
  let fetchMock: jest.Mock;
  let dailyResponse: () => unknown;

  afterEach(() => jest.useRealTimers());

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({
      now: new Date('2026-07-14T03:00:00Z'),
      doNotFake: [
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
        'setImmediate', 'clearImmediate', 'queueMicrotask',
        'requestAnimationFrame', 'cancelAnimationFrame',
        'requestIdleCallback', 'cancelIdleCallback',
        'hrtime', 'nextTick', 'performance',
      ],
    });
    dailyResponse = () => ({ ok: true, status: 200, json: async () => ({ success: true, records_saved: 1, message: 'ok' }) });
    fetchMock = jest.fn(async (url: string) => {
      if (url.startsWith('/api/production-records?')) {
        return { ok: true, json: async () => ({ records: [RECORD_A] }) };
      }
      if (url.startsWith('/api/downtime-entries?')) return { ok: true, json: async () => ({ success: true, data: [] }) };
      if (url.startsWith('/api/production-records/daily')) return dailyResponse();
      return { ok: true, json: async () => ({ success: true }) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('보내는 교대마다 화면이 본 기록의 지문을 expected_records 로 보낸다', async () => {
    renderForm();
    await selectMachine();
    const saveButton = (await screen.findByText('editMode.updateData')).closest('button')!;
    await waitFor(() => expect(saveButton.disabled).toBe(false));
    fireEvent.click(saveButton);

    await waitFor(() => expect(dailyCalls(fetchMock)).toHaveLength(1));
    const payload = JSON.parse(String(dailyCalls(fetchMock)[0][1]?.body));
    expect(payload.expected_records).toEqual({
      A: {
        record_id: 'rec-1', output_qty: 100, defect_qty: 2, planned_runtime: 660, actual_runtime: 640,
        ideal_runtime: 200, downtime_minutes: 20, tact_time_seconds: 120, availability: 0.9697,
        performance: 0.3125, quality: 0.98, oee: 0.297,
      },
    });
    // 보내지 않는 교대(B: 기록 없음·입력 없음)는 지문도 없다
    expect(payload).not.toHaveProperty('night_shift');
  });

  it('기록이 없던 교대를 새로 저장하면 지문은 null("기록 없음을 봤다")이다', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/production-records?')) {
        return { ok: true, json: async () => ({ records: [], shift_states: [{ shift: 'B', status: 'OFF', version: 1 }] }) };
      }
      if (url.startsWith('/api/downtime-entries?')) return { ok: true, json: async () => ({ success: true, data: [] }) };
      if (url.startsWith('/api/production-records/daily')) return dailyResponse();
      return { ok: true, json: async () => ({ success: true }) };
    });
    renderForm();
    await selectMachine();
    const saveButton = (await screen.findByText('editMode.newRecord')).closest('button')!;
    // 불러온 휴무 상태가 화면에 반영된 뒤에 저장한다(체크박스 순서: 주간 휴무·주간 가동확인·야간 휴무·야간 가동확인)
    await waitFor(() => expect((screen.getAllByRole('checkbox')[2] as HTMLInputElement).checked).toBe(true));
    await waitFor(() => expect(saveButton.disabled).toBe(false));
    fireEvent.click(saveButton);

    await waitFor(() => expect(dailyCalls(fetchMock)).toHaveLength(1));
    const payload = JSON.parse(String(dailyCalls(fetchMock)[0][1]?.body));
    // B 는 휴무로 불러왔으므로 휴무로 다시 보내며, 그때 본 상태는 "기록 없음"이다
    expect(payload.night_shift_off).toBe(true);
    expect(payload.expected_records).toEqual({ B: null });
  });

  it('서버가 record_changed(409)로 거부하면 입력을 지우지 않고 최신 기록을 다시 불러온다', async () => {
    dailyResponse = () => ({
      ok: false, status: 409,
      json: async () => ({ success: false, error: 'record_changed', shift: 'A', message: 'changed' }),
    });
    renderForm();
    await selectMachine();
    const saveButton = (await screen.findByText('editMode.updateData')).closest('button')!;
    await waitFor(() => expect(saveButton.disabled).toBe(false));
    const listBefore = listCalls(fetchMock).length;
    fireEvent.click(saveButton);

    await waitFor(() => expect(dailyCalls(fetchMock)).toHaveLength(1));
    await waitFor(() => expect(listCalls(fetchMock).length).toBe(listBefore + 1));
    await waitFor(() => expect(screen.getByText('messages.recordChangedReload')).toBeTruthy());
    // 폼이 초기화되지 않았다 — 설비 선택과 입력 카드가 그대로다
    expect(screen.getByText('dataEntry.shiftDataInput')).toBeTruthy();
    expect(screen.queryByText('messages.saveFailed', { exact: false })).toBeNull();
  });
});
