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
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

const selectMachineByIndex = async (index: number) => {
  const select = document.querySelector('.ant-select-selector');
  fireEvent.mouseDown(select!);
  await waitFor(() => expect(document.querySelectorAll('.ant-select-item-option').length).toBe(2));
  fireEvent.click(document.querySelectorAll('.ant-select-item-option')[index]!);
  await waitFor(() => expect(screen.getByText('dataEntry.shiftDataInput')).toBeTruthy());
};

/** 저장 요청이 전송되었는지 */
const savePosted = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.some(
    ([url, init]) => String(url).includes('/api/production-records/daily') && init?.method === 'POST'
  );

describe('ShiftDataInputForm - 비가동 조회 실패 (#1)', () => {
  let fetchMock: jest.Mock;

  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // 기본 교대(A/B)는 현재 시각으로 결정된다. A교대(회사 시간대 08:00~20:00) 한가운데인
    // 2026-07-14 10:00 Asia/Ho_Chi_Minh(=03:00Z)로 Date 만 고정해 시각 의존 실패를 없앤다.
    // 타이머·microtask 는 doNotFake 로 진짜를 유지해 waitFor/비동기 로딩 타이밍은 그대로 둔다.
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

  it('비가동 조회가 실패해도 생산수량 저장은 독립적으로 진행하고 서버가 비가동을 재조회한다', async () => {
    renderForm();
    await selectMachine();

    await waitFor(() => {
      expect(screen.getAllByText('downtime.loadFailedTitle').length).toBeGreaterThan(0);
    });

    // 저장 시도
    // 기존 기록이 있으므로 버튼 라벨은 editMode.updateData 다
    const saveButton = screen.getByText('editMode.updateData').closest('button')!;
    await waitFor(() => expect(saveButton.disabled).toBe(false));
    fireEvent.click(saveButton!);

    // 생산실적과 비가동은 독립된 원본이다. 화면 조회 실패가 생산수량 입력을 막지 않는다.
    await waitFor(() => {
      expect(savePosted(fetchMock)).toBe(true);
    });

    // 조회에 실패한 화면의 0분을 서버로 보내지 않는다. 서버가 원본 사건을 직접
    // 재집계하고, 서버 조회마저 실패하면 0 으로 단정하지 않고 NULL 을 유지한다
    // (daily/downtimeCalculation.ts resolveConfirmedDowntimeMinutes).
    expect(screen.queryByText('downtime.confirmZeroTitle')).toBeNull();
    const dailyCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/api/production-records/daily') && init?.method === 'POST'
    );
    const payload = JSON.parse(String(dailyCall?.[1]?.body));
    expect(payload.day_shift).not.toHaveProperty('total_downtime_minutes');
    expect(payload.day_shift).not.toHaveProperty('downtime_confirmed');
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
            data: [{
              id: 'dt-1',
              machine_id: MACHINE.id,
              date: '2026-07-14',
              shift: 'A',
              duration_minutes: 30,
              reason: 'equipmentFailure',
              start_time: '2026-07-14T01:00:00Z',
              end_time: '2026-07-14T01:30:00Z'
            }]
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
    const saveButton = screen.getByText('editMode.updateData').closest('button')!;
    await waitFor(() => expect(saveButton.disabled).toBe(false));
    fireEvent.click(saveButton);

    // 비가동이 30분이므로 무중단 확인 모달 없이 바로 저장된다
    await waitFor(() => {
      expect(savePosted(fetchMock)).toBe(true);
    });

    const dailyCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/api/production-records/daily') && init?.method === 'POST'
    );
    const payload = JSON.parse(String(dailyCall?.[1]?.body));
    expect(payload).not.toHaveProperty('day_downtime_entries');
    expect(payload).not.toHaveProperty('night_downtime_entries');
    expect(fetchMock.mock.calls.some(
      ([url, init]) => String(url) === '/api/downtime-entries' && init?.method === 'POST'
    )).toBe(false);
  });

  it('설비 전환 조회가 끝나기 전에는 이전 기록으로 저장할 수 없다', async () => {
    let resolveSecond!: (value: unknown) => void;
    const secondResponse = new Promise(resolve => { resolveSecond = resolve; });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('machine_id=machine-2') && url.startsWith('/api/production-records?')) {
        return secondResponse;
      }
      if (url.startsWith('/api/production-records?')) {
        return { ok: true, json: async () => ({ records: [{ record_id: 'a', shift: 'A', output_qty: 100, defect_qty: 0 }] }) };
      }
      if (url.startsWith('/api/downtime-entries?')) {
        return { ok: true, json: async () => ({ success: true, data: [] }) };
      }
      return { ok: true, json: async () => ({ success: true }) };
    });

    renderForm();
    await selectMachineByIndex(0);
    await waitFor(() => expect(screen.getByText('editMode.updateData')).toBeTruthy());
    await selectMachineByIndex(1);

    const saveButton = screen.getByText('editMode.newRecord').closest('button')!;
    expect(saveButton.disabled).toBe(true);
    fireEvent.click(saveButton);
    expect(savePosted(fetchMock)).toBe(false);

    resolveSecond({ ok: true, json: async () => ({ records: [] }) });
    await waitFor(() => expect(saveButton.disabled).toBe(false));
  });

  it('응답 순서가 뒤집혀도 이전 설비 응답이 최신 선택을 덮어쓰지 않는다', async () => {
    let resolveFirst!: (value: unknown) => void;
    const firstResponse = new Promise(resolve => { resolveFirst = resolve; });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('machine_id=machine-1') && url.startsWith('/api/production-records?')) return firstResponse;
      if (url.startsWith('/api/production-records?')) return { ok: true, json: async () => ({ records: [] }) };
      if (url.startsWith('/api/downtime-entries?')) return { ok: true, json: async () => ({ success: true, data: [] }) };
      return { ok: true, json: async () => ({ success: true }) };
    });

    renderForm();
    await selectMachineByIndex(0);
    await selectMachineByIndex(1);
    await waitFor(() => expect(screen.getByText('editMode.newRecord').closest('button')!.disabled).toBe(false));

    resolveFirst({ ok: true, json: async () => ({ records: [{ record_id: 'stale-a', shift: 'A', output_qty: 999, defect_qty: 0 }] }) });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('editMode.updateData')).toBeNull();
  });

  it('기존 생산 기록 조회가 실패하면 다른 교대 데이터까지 보호하도록 저장을 전부 차단한다', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/production-records?')) {
        return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      }
      if (url.includes('shift=A') && url.startsWith('/api/downtime-entries?')) {
        return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      }
      if (url.startsWith('/api/downtime-entries?')) {
        return { ok: true, json: async () => ({ success: true, data: [] }) };
      }
      return { ok: true, json: async () => ({ success: true }) };
    });

    renderForm();
    await selectMachine();
    await waitFor(() => expect(screen.getByText('recordList.loadFailedTitle')).toBeTruthy());

    const saveButton = screen.getByText('editMode.newRecord').closest('button')!;
    await waitFor(() => expect(saveButton.disabled).toBe(false));
    fireEvent.click(saveButton);
    await waitFor(() => expect(savePosted(fetchMock)).toBe(false));
  });

  it('기존 비가동이 있는 교대를 휴무로 바꿔도 생산 저장 payload로 비가동을 삭제하지 않는다', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/production-records?')) {
        return {
          ok: true,
          json: async () => ({ records: [{
            record_id: 'rec-1', shift: 'A', output_qty: 100, defect_qty: 2, planned_runtime: 660
          }] })
        };
      }
      if (url.startsWith('/api/downtime-entries?')) {
        return {
          ok: true,
          json: async () => ({ success: true, data: [{
            id: 'dt-1', machine_id: MACHINE.id, date: '2026-07-14', shift: 'A',
            duration_minutes: 30, reason: 'equipmentFailure',
            start_time: '2026-07-14T01:00:00Z', end_time: '2026-07-14T01:30:00Z'
          }] })
        };
      }
      if (url.startsWith('/api/production-records/daily')) {
        return { ok: true, json: async () => ({ success: true, records_saved: 1 }) };
      }
      return { ok: true, json: async () => ({ success: true }) };
    });

    renderForm();
    await selectMachine();
    await waitFor(() => expect(screen.getByText('editMode.updateData')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('editMode.updateData').closest('button')!);

    await waitFor(() => expect(savePosted(fetchMock)).toBe(true));
    const dailyCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/api/production-records/daily') && init?.method === 'POST'
    );
    const payload = JSON.parse(String(dailyCall?.[1]?.body));
    expect(payload.day_shift_off).toBe(true);
    expect(payload).not.toHaveProperty('day_downtime_entries');
    expect(fetchMock.mock.calls.some(
      ([url, init]) => String(url).startsWith('/api/downtime-entries/') && init?.method === 'DELETE'
    )).toBe(false);
  });

  it('생산실적이 없어도 종료시각 없는 비가동을 즉시 독립 저장한다', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/production-records?')) {
        return { ok: true, json: async () => ({ records: [] }) };
      }
      if (url.startsWith('/api/downtime-entries?')) {
        return { ok: true, json: async () => ({ success: true, data: [] }) };
      }
      if (url === '/api/downtime-entries' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: 'dt-open-1',
              ...body,
              end_time: null,
              duration_minutes: null,
              version: 1,
              created_at: '2026-07-14T03:00:00Z',
              updated_at: '2026-07-14T03:00:00Z'
            }
          })
        };
      }
      return { ok: true, json: async () => ({ success: true }) };
    });

    renderForm();
    await selectMachine();
    await waitFor(() => expect(screen.getByText('editMode.newRecord')).toBeTruthy());

    fireEvent.click(screen.getByText('downtime.addDowntime'));
    await waitFor(() => expect(document.querySelector('.ant-modal')).toBeTruthy());

    const modal = document.querySelector('.ant-modal')!;
    const reasonSelect = modal.querySelector('.ant-select-selector')!;
    fireEvent.mouseDown(reasonSelect);
    await waitFor(() => expect(screen.getByText('downtime.reasons.equipmentFailure')).toBeTruthy());
    fireEvent.click(screen.getByText('downtime.reasons.equipmentFailure'));

    fireEvent.click(screen.getByText('downtime.add').closest('button')!);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(
        ([url, init]) => String(url) === '/api/downtime-entries' && init?.method === 'POST'
      )).toBe(true);
    });

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/downtime-entries' && init?.method === 'POST'
    );
    const payload = JSON.parse(String(createCall?.[1]?.body));
    expect(payload.machine_id).toBe(MACHINE.id);
    expect(payload.date).toBe('2026-07-14');
    expect(payload.shift).toBe('A');
    expect(payload.end_time).toBeNull();
    expect(savePosted(fetchMock)).toBe(false);

    // 비가동 사건은 이미 별도 저장됐다. 생산 저장 버튼을 눌러도 비가동만 있다는
    // 이유로 output=0 생산실적을 만들면 안 된다.
    fireEvent.click(screen.getByText('editMode.newRecord').closest('button')!);
    await waitFor(() => expect(savePosted(fetchMock)).toBe(true));
    const productionCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/api/production-records/daily') && init?.method === 'POST'
    );
    const productionPayload = JSON.parse(String(productionCall?.[1]?.body));
    expect(productionPayload).not.toHaveProperty('day_shift');
    expect(productionPayload).not.toHaveProperty('night_shift');
  });

  it('진행 중 사건을 같은 ID와 expected_version으로 종료한다', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/production-records?')) {
        return { ok: true, json: async () => ({ records: [] }) };
      }
      if (url.includes('shift=A') && url.startsWith('/api/downtime-entries?')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [{
              id: 'dt-open-1',
              machine_id: MACHINE.id,
              date: '2026-07-14',
              shift: 'A',
              start_time: '2026-07-14T01:00:00Z',
              end_time: null,
              duration_minutes: null,
              reason: 'equipmentFailure',
              version: 4,
              created_at: '2026-07-14T01:00:00Z',
              updated_at: '2026-07-14T01:00:00Z'
            }]
          })
        };
      }
      if (url.startsWith('/api/downtime-entries?')) {
        return { ok: true, json: async () => ({ success: true, data: [] }) };
      }
      if (url === '/api/downtime-entries/dt-open-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: 'dt-open-1',
              machine_id: MACHINE.id,
              date: '2026-07-14',
              shift: 'A',
              start_time: '2026-07-14T01:00:00Z',
              end_time: body.end_time,
              duration_minutes: 30,
              reason: 'equipmentFailure',
              version: 5
            }
          })
        };
      }
      return { ok: true, json: async () => ({ success: true }) };
    });

    renderForm();
    await selectMachine();
    await waitFor(() => expect(screen.getByText('common.close')).toBeTruthy());
    fireEvent.click(screen.getByText('common.close'));

    await waitFor(() => expect(fetchMock.mock.calls.some(
      ([url, init]) => String(url) === '/api/downtime-entries/dt-open-1' && init?.method === 'PATCH'
    )).toBe(true));

    const closeCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/downtime-entries/dt-open-1' && init?.method === 'PATCH'
    );
    const payload = JSON.parse(String(closeCall?.[1]?.body));
    expect(payload.expected_version).toBe(4);
    expect(payload.end_time).toEqual(expect.any(String));
  });
});
