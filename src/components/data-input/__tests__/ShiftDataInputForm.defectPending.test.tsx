/**
 * ShiftDataInputForm - 불량 미검사(빈칸≠0)와 저장 오류 번역 (사용자 확정 2026-11-14)
 *
 * 예전에는 미검사(defect NULL) 기록을 열면 불량 칸이 0 으로 채워져, 그대로 저장하는 순간 '불량 0 확정'이 됐다.
 * 새 기록도 0 으로 시작해 손대지 않고 저장하면 0 확정이었다. 이제 둘 다 빈칸이고 빈칸은 null 로 보낸다.
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

const PENDING_A = {
  record_id: 'rec-p', machine_id: MACHINE.id, date: '2026-07-14', shift: 'A',
  output_qty: 100, defect_qty: null, planned_runtime: 610, actual_runtime: 610, ideal_runtime: 200,
  downtime_minutes: 0, tact_time_seconds: 120, availability: 1, performance: 0.33, quality: null, oee: null,
};

const dailyCalls = (fetchMock: jest.Mock) => fetchMock.mock.calls.filter(
  ([url, init]) => String(url).includes('/api/production-records/daily') && init?.method === 'POST'
);
// 입력란 순서: 주간 기준 가동시간, 야간 기준 가동시간, 주간 생산, 주간 불량, 주간 양품, ...
const numberInputs = () => Array.from(document.querySelectorAll('.ant-input-number-input')) as HTMLInputElement[];

describe('ShiftDataInputForm - 불량 미검사(빈칸≠0)', () => {
  let fetchMock: jest.Mock;
  let records: unknown[];
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
    records = [PENDING_A];
    dailyResponse = () => ({ ok: true, status: 200, json: async () => ({ success: true, records_saved: 1, message: 'ok' }) });
    fetchMock = jest.fn(async (url: string) => {
      if (url.startsWith('/api/production-records?')) return { ok: true, json: async () => ({ records }) };
      if (url.startsWith('/api/downtime-entries?')) return { ok: true, json: async () => ({ success: true, data: [] }) };
      if (url.startsWith('/api/production-records/daily')) return dailyResponse();
      return { ok: true, json: async () => ({ success: true }) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('미검사 기록을 열면 불량 칸은 빈칸이고, 그대로 저장하면 불량 null(미검사 유지)을 보낸다', async () => {
    renderForm();
    await selectMachine();
    const saveButton = (await screen.findByText('editMode.updateData')).closest('button')!;
    await waitFor(() => expect(numberInputs()[2].value).toBe('100'));
    expect(numberInputs()[3].value).toBe('');
    // 일일 요약도 불량·OEE 를 0 으로 꾸미지 않는다
    expect(screen.getAllByTitle('dataEntry.defectPendingHint').length).toBe(2);

    await waitFor(() => expect(saveButton.disabled).toBe(false));
    fireEvent.click(saveButton);
    await waitFor(() => expect(dailyCalls(fetchMock)).toHaveLength(1));
    const payload = JSON.parse(String(dailyCalls(fetchMock)[0][1]?.body));
    expect(payload.day_shift.defect_quantity).toBeNull();
    expect(payload.day_shift.actual_production).toBe(100);
  });

  it('새 기록의 불량 칸은 빈칸으로 시작하고, 생산만 넣고 저장하면 불량 null 을 보낸다', async () => {
    records = [];
    renderForm();
    await selectMachine();
    const saveButton = (await screen.findByText('editMode.newRecord')).closest('button')!;
    await waitFor(() => expect(saveButton.disabled).toBe(false));
    expect(numberInputs()[3].value).toBe('');

    fireEvent.change(numberInputs()[2], { target: { value: '80' } });
    fireEvent.blur(numberInputs()[2]);
    await waitFor(() => expect(numberInputs()[2].value).toBe('80'));
    fireEvent.click(saveButton);

    await waitFor(() => expect(dailyCalls(fetchMock)).toHaveLength(1));
    const payload = JSON.parse(String(dailyCalls(fetchMock)[0][1]?.body));
    expect(payload.day_shift).toMatchObject({ actual_production: 80, defect_quantity: null });
  });

  it('불량 0 을 직접 입력하면 0(불량 없음 확정)을 보낸다', async () => {
    renderForm();
    await selectMachine();
    const saveButton = (await screen.findByText('editMode.updateData')).closest('button')!;
    await waitFor(() => expect(numberInputs()[2].value).toBe('100'));
    fireEvent.change(numberInputs()[3], { target: { value: '0' } });
    fireEvent.blur(numberInputs()[3]);
    await waitFor(() => expect(numberInputs()[3].value).toBe('0'));
    fireEvent.click(saveButton);

    await waitFor(() => expect(dailyCalls(fetchMock)).toHaveLength(1));
    const payload = JSON.parse(String(dailyCalls(fetchMock)[0][1]?.body));
    expect(payload.day_shift.defect_quantity).toBe(0);
  });

  it('서버 오류 코드는 화면 언어 문구(dailyErrors.<code>)로 보여 준다', async () => {
    dailyResponse = () => ({
      ok: false, status: 400,
      json: async () => ({
        success: false, error: '주간조의 확정된 불량 수량은 비울 수 없습니다.',
        code: 'defect_unconfirm_not_allowed', params: { shift: 'A' },
      }),
    });
    renderForm();
    await selectMachine();
    const saveButton = (await screen.findByText('editMode.updateData')).closest('button')!;
    await waitFor(() => expect(saveButton.disabled).toBe(false));
    fireEvent.click(saveButton);

    await waitFor(() => expect(screen.getByText('messages.saveFailed: dailyErrors.defect_unconfirm_not_allowed')).toBeTruthy());
    // 한국어 서버 문구를 그대로 보여 주지 않는다
    expect(screen.queryByText(/확정된 불량 수량은 비울 수 없습니다/)).toBeNull();
  });
});
