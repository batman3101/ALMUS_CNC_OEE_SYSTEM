/**
 * CloseShiftQueue — 마감과 함께 최종 불량 입력 (2026-09-28 사용자 요청).
 *
 * 지키는 것:
 * 1. 불량을 넣으면 마감 요청에 실린다. 0 도 값이다(검사했고 불량 없음).
 * 2. 비워 두면 **보내지 않는다** — 미검사(NULL)를 0 으로 바꾸면 확인하지 않은 0 이 확정 불량으로 남는다.
 * 3. 불량 > 최종수량은 요청 전에 막는다.
 * 4. 실패·이미 마감됨이면 행과 입력값을 남긴다(서버가 마감+불량을 한 트랜잭션으로 저장하므로 반쪽 성공은 없다).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { CloseShiftQueue } from '../CloseShiftQueue';

jest.mock('@/hooks/useTranslation', () => ({
  useDataInputTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${JSON.stringify(vars)})` : key),
  }),
}));
jest.mock('@/hooks/useMachines', () => ({ useMachines: () => ({ machines: [], loading: false }) }));
jest.mock('@/hooks/useFailureReport', () => ({ useFailureReport: () => jest.fn() }));

const mockAuthFetch = jest.fn();
jest.mock('@/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => mockAuthFetch(...a) }));

const ITEM = { machine_id: 'm-1', machine_name: 'CNC-665', date: '2026-09-27', shift: 'B', last_qty: 54 };
const KEY = `${ITEM.machine_id}|${ITEM.date}|${ITEM.shift}`;

const queueResponse = { ok: true, json: async () => ({ items: [ITEM], pagination: { total: 1 }, truncated: false }) };
let closeResponse: { ok: boolean; status: number; json: () => Promise<unknown> };

beforeEach(() => {
  jest.clearAllMocks();
  closeResponse = { ok: true, status: 201, json: async () => ({ success: true, defect: 'saved' }) };
  mockAuthFetch.mockImplementation(async (url: string) =>
    url.startsWith('/api/production-records/close-queue') ? queueResponse : closeResponse);
});

// antd Table 첫 렌더는 전체 스위트 병렬 실행 중 1초(기본 대기)를 넘기기도 한다 — 기다림을 넉넉히 준다.
const WAIT = { timeout: 10_000 };
const renderQueue = async () => {
  render(<App><CloseShiftQueue /></App>);
  await screen.findByText('CNC-665', undefined, WAIT);
};
const defectInput = () => screen.getByTestId(`close-queue-defect-${KEY}`) as HTMLInputElement;
const typeDefect = (v: string) => fireEvent.change(defectInput(), { target: { value: v } });
const clickClose = () => fireEvent.click(screen.getByText('closeQueue.close'));
const closeCalls = () => mockAuthFetch.mock.calls.filter(c => c[0] === '/api/production-records/close-shift');
const sentBody = () => JSON.parse(closeCalls()[0][1].body as string);

describe('CloseShiftQueue 최종 불량', () => {
  it('불량 칸은 비어서 시작한다 (0 을 미리 채우지 않는다)', async () => {
    await renderQueue();
    expect(defectInput().value).toBe('');
  });

  it('입력한 불량을 마감 요청에 싣는다', async () => {
    await renderQueue();
    typeDefect('3');
    clickClose();
    await waitFor(() => expect(closeCalls()).toHaveLength(1), WAIT);
    expect(sentBody()).toEqual(expect.objectContaining({ final_qty: 54, defect_qty: 3 }));
  });

  it('불량 0 도 보낸다', async () => {
    await renderQueue();
    typeDefect('0');
    clickClose();
    await waitFor(() => expect(closeCalls()).toHaveLength(1), WAIT);
    expect(sentBody().defect_qty).toBe(0);
  });

  it('비워 두면 defect_qty 를 보내지 않는다 (미검사 → 불량 대기)', async () => {
    closeResponse = { ok: true, status: 201, json: async () => ({ success: true, defect: 'not_requested' }) };
    await renderQueue();
    clickClose();
    await waitFor(() => expect(closeCalls()).toHaveLength(1), WAIT);
    expect('defect_qty' in sentBody()).toBe(false);
  });

  it('불량이 최종수량보다 많으면 요청하지 않고 행에 이유를 적는다', async () => {
    await renderQueue();
    typeDefect('55');
    clickClose();
    expect(await screen.findByText('closeQueue.errorDefectExceeds({"qty":54})', undefined, WAIT)).toBeTruthy();
    expect(closeCalls()).toHaveLength(0);
  });

  it('이미 다른 사람이 마감했으면 행과 입력값을 남기고 이유를 적는다 (감사 F-02)', async () => {
    // 행을 지우면 사용자가 넣으려던 숫자까지 사라져, 무엇을 확인·수정해야 하는지 알 수 없게 된다.
    closeResponse = { ok: false, status: 409, json: async () => ({ error: 'already_closed' }) };
    await renderQueue();
    typeDefect('3');
    clickClose();
    expect(await screen.findByText('closeQueue.errorAlreadyClosed', undefined, WAIT)).toBeTruthy();
    expect(screen.getByText('CNC-665')).toBeTruthy();
    expect(defectInput().value).toBe('3');
  });

  it('저장 실패(500)면 입력값을 잃지 않는다', async () => {
    closeResponse = { ok: false, status: 500, json: async () => ({ error: 'Failed to close shift' }) };
    await renderQueue();
    typeDefect('3');
    clickClose();
    expect(await screen.findByText('closeQueue.errorGeneric', undefined, WAIT)).toBeTruthy();
    expect(defectInput().value).toBe('3');
  });
});
