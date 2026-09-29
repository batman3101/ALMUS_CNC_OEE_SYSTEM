import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ForecastSourceRow } from '@/types/forecast';
import ForecastQuantityTable from '../ForecastQuantityTable';

const mockFetch = jest.fn();
jest.mock('@/lib/authFetch', () => ({ authFetch: (url: string, init?: RequestInit) => mockFetch(url, init) }));
// 번역은 키 그대로 돌려준다 - 문구가 아니라 어느 안내가 떴는지를 검사한다.
jest.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, language: 'ko' }) }));

type Props = ComponentProps<typeof ForecastQuantityTable>;
const SUBMISSION = '11111111-1111-4111-8111-111111111111';
const numberFormat = new Intl.NumberFormat('ko-KR');
const makeRow = (over: Partial<ForecastSourceRow> = {}): ForecastSourceRow => ({
  sourceRow: 15, model: 'ON 1', displayModel: 'ON 1', vendor: 'ALMUS', processGroup: 'CNC', processLabel: 'CNC 1 ~ CNC 2', processes: ['CNC1', 'CNC2'], issues: [],
  quantities: [
    { date: '2026-09-22', cell: 'I15', quantity: 9000, state: 'number', formula: true, error: null },
    { date: '2026-09-23', cell: 'J15', quantity: null, state: 'blank', formula: false, error: null },
  ],
  ...over,
});
/** 9/22 에 실제 PO 수정값이 붙은 행. */
const withPo = (quantity = 12000): ForecastSourceRow => makeRow({ quantities: [
  { date: '2026-09-22', cell: 'I15', quantity: 9000, state: 'number', formula: true, error: null, po: { quantity, updatedAt: '2026-09-29T05:00:00Z' } },
  { date: '2026-09-23', cell: 'J15', quantity: null, state: 'blank', formula: false, error: null },
] });
const ok = (body: object) => ({ ok: true, status: 200, json: async () => ({ success: true, ...body }) });
const reject = (status: number, body: object) => ({ ok: false, status, json: async () => ({ success: false, ...body }) });

function setup(props: Partial<Props> = {}) {
  const onChange = jest.fn();
  const onError = jest.fn();
  const view = render(<ForecastQuantityTable row={makeRow()} submissionId={SUBMISSION} numberFormat={numberFormat} onChange={onChange} onError={onError} {...props} />);
  return { onChange, onError, ...view };
}
const type = (date: string, value: string) => fireEvent.change(screen.getByLabelText('po.input ' + date), { target: { value } });
const applyButton = (date: string) => screen.getByRole('button', { name: 'po.apply ' + date });
const enter = (date: string) => fireEvent.keyDown(screen.getByLabelText('po.input ' + date), { key: 'Enter', keyCode: 13 });

describe('ForecastQuantityTable - 실제 PO 수량 입력', () => {
  const originalStyle = window.getComputedStyle.bind(window);
  beforeAll(() => { jest.spyOn(window, 'getComputedStyle').mockImplementation(element => originalStyle(element)); });
  afterAll(() => jest.restoreAllMocks());
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue(ok({ po: { quantity: 12000, updatedAt: '2026-09-29T05:00:00Z' }, unchanged: false }));
  });

  it('날짜마다 입력 칸과 [적용]이 있고, 값이 바뀌기 전에는 적용할 수 없다', () => {
    setup();
    expect(screen.getByLabelText('po.input 2026-09-22')).toBeEnabled();
    expect(screen.getByLabelText('po.input 2026-09-23')).toBeEnabled();
    expect(applyButton('2026-09-22')).toBeDisabled();
    type('2026-09-22', '12000');
    expect(applyButton('2026-09-22')).toBeEnabled();
    // 다른 날짜는 건드리지 않았으니 그대로 꺼져 있다.
    expect(applyButton('2026-09-23')).toBeDisabled();
  });

  it('[적용]은 접수 번호·행·날짜·수량을 PUT 으로 보내고, 서버가 받아들인 값을 부모에 알린다', async () => {
    const { onChange, onError } = setup();
    type('2026-09-22', '12000');
    fireEvent.click(applyButton('2026-09-22'));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/forecasts/po-overrides');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ submissionId: SUBMISSION, sourceRow: 15, date: '2026-09-22', quantity: 12000 });
    expect(onChange).toHaveBeenCalledWith(SUBMISSION, 15, '2026-09-22', { quantity: 12000, updatedAt: '2026-09-29T05:00:00Z' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('Enter 키로도 적용된다 - 원본이 빈 칸인 날짜에도 입력할 수 있다', async () => {
    const { onChange } = setup();
    type('2026-09-23', '500');
    enter('2026-09-23');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({ date: '2026-09-23', quantity: 500 });
  });

  it('수량 0 도 유효한 PO 수량이다 (원본이 0 이 아니어도 적용할 수 있다)', async () => {
    const { onChange } = setup();
    type('2026-09-22', '0');
    expect(applyButton('2026-09-22')).toBeEnabled();
    fireEvent.click(applyButton('2026-09-22'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).quantity).toBe(0);
  });

  it('적용된 칸은 사용값을 크게, 원본 Forecast 수량을 그 아래에 보이고 [원복]을 준다', () => {
    setup({ row: withPo() });
    expect(screen.getByText('12,000')).toBeInTheDocument();
    expect(screen.getByText('po.forecastOriginal')).toBeInTheDocument();
    expect(screen.getByText('po.tag')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'po.revert 2026-09-22' })).toBeEnabled();
    // 수정값이 없는 날짜에는 원복이 없다.
    expect(screen.queryByRole('button', { name: 'po.revert 2026-09-23' })).not.toBeInTheDocument();
    // 입력 칸에는 적용된 값이 들어 있다.
    expect(screen.getByLabelText('po.input 2026-09-22')).toHaveValue('12000');
  });

  it('원본이 빈 칸이어도 PO 가 있으면 그 값이 사용값으로 보이고, 원본 상태 표시는 그대로다', () => {
    setup({ row: makeRow({ quantities: [{ date: '2026-09-23', cell: 'J15', quantity: null, state: 'blank', formula: false, error: null, po: { quantity: 500, updatedAt: 't' } }] }) });
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('states.blank')).toBeInTheDocument();
  });

  it('[원복]은 DELETE 를 보내고, 부모에는 수정값 없음(null)으로 알린다', async () => {
    mockFetch.mockResolvedValue(ok({ reverted: true }));
    const { onChange } = setup({ row: withPo() });
    fireEvent.click(screen.getByRole('button', { name: 'po.revert 2026-09-22' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(SUBMISSION, 15, '2026-09-22', null));
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ submissionId: SUBMISSION, sourceRow: 15, date: '2026-09-22' });
  });

  it('이미 적용된 값과 같은 값으로 되돌려 놓으면 다시 적용할 수 없다', () => {
    setup({ row: withPo(12000) });
    type('2026-09-22', '12001');
    expect(applyButton('2026-09-22')).toBeEnabled();
    type('2026-09-22', '12000');
    expect(applyButton('2026-09-22')).toBeDisabled();
  });

  it.each([
    ['접수 확정 전(접수 번호 없음)', { submissionId: null }, 'po.needsAcceptance'],
    ['시뮬레이션 대상이 아닌 행(CNC1~CNC2 로 매핑되지 않음)', { row: makeRow({ processes: [] }) }, 'po.unsupportedRow'],
    ['모델이 비어 있는 행', { row: makeRow({ model: '' }) }, 'po.unsupportedRow'],
  ] as [string, Partial<Props>, string][])('%s 에서는 입력·적용이 막히고 이유가 보인다', (_label, props, reason) => {
    setup(props);
    expect(screen.getByTestId('po-disabled-reason')).toHaveTextContent(reason);
    expect(screen.getByLabelText('po.input 2026-09-22')).toBeDisabled();
    expect(applyButton('2026-09-22')).toBeDisabled();
  });

  it('입력 가능한 행에는 막힘 안내가 없다', () => {
    setup();
    expect(screen.queryByTestId('po-disabled-reason')).not.toBeInTheDocument();
  });

  it.each([
    [409, 'submission_changed', { code: 'submission_changed' }],
    [404, 'po_target_not_found', { code: 'po_target_not_found' }],
    [422, 'po_row_unsupported', { code: 'po_row_unsupported' }],
    [400, 'invalid_request', { code: 'invalid_request' }],
    [403, 'forbidden', { code: 'anything' }],
    [401, 'unauthorized', {}],
    [500, 'po_save_failed', { code: 'po_save_failed' }],
    [500, 'po_save_failed', {}],
  ] as [number, string, object][])('서버가 %s 로 거부하면 오류 코드 %s 를 응답과 함께 부모에 알리고, 입력한 값은 남겨 둔다', async (status, code, body) => {
    mockFetch.mockResolvedValue(reject(status, body));
    const { onChange, onError } = setup();
    type('2026-09-22', '12000');
    fireEvent.click(applyButton('2026-09-22'));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    // 응답을 원인으로 넘긴다 - 부모가 세션 만료(401)를 가려내는 데 쓴다.
    expect(onError).toHaveBeenCalledWith(code, expect.objectContaining({ status }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('po.input 2026-09-22')).toHaveValue('12000');
    expect(screen.getByLabelText('po.input 2026-09-22')).toBeEnabled();
  });

  it('통신이 끊기면 po_save_failed 로 알리고 원인을 콘솔에 남긴다', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('network');
    mockFetch.mockRejectedValue(failure);
    const { onChange, onError } = setup();
    type('2026-09-22', '12000');
    fireEvent.click(applyButton('2026-09-22'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('po_save_failed', failure));
    expect(onChange).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('응답을 기다리는 동안에는 다시 눌러도 Enter 를 쳐도 요청이 한 번만 나간다', async () => {
    let finish: (response: unknown) => void = () => {};
    mockFetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { onChange } = setup();
    type('2026-09-22', '12000');
    fireEvent.click(applyButton('2026-09-22'));
    fireEvent.click(applyButton('2026-09-22'));
    enter('2026-09-22');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('po.input 2026-09-22')).toBeDisabled();
    await act(async () => finish(ok({ po: { quantity: 12000, updatedAt: 't' }, unchanged: false })));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('응답을 기다리는 사이 접수 번호가 바뀌어도 부모에는 요청을 보낼 때의 접수 번호를 넘긴다 (부모가 낡은 응답을 버릴 수 있게)', async () => {
    let finish: (response: unknown) => void = () => {};
    mockFetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { onChange, onError, rerender } = setup();
    type('2026-09-22', '12000');
    fireEvent.click(applyButton('2026-09-22'));
    const NEXT = '22222222-2222-4222-8222-222222222222';
    rerender(<ForecastQuantityTable row={makeRow()} submissionId={NEXT} numberFormat={numberFormat} onChange={onChange} onError={onError} />);
    await act(async () => finish(ok({ po: { quantity: 12000, updatedAt: 't' }, unchanged: false })));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).submissionId).toBe(SUBMISSION);
    expect(onChange).toHaveBeenCalledWith(SUBMISSION, 15, '2026-09-22', { quantity: 12000, updatedAt: 't' });
  });
});
