/**
 * ProgressInputModal — 태블릿 진행 보고 입력.
 *
 * 이 테스트가 지키는 것은 세 가지다. 셋 다 "보이는 것"이 아니라 "되는 것"을 검증한다.
 *
 * 1. 실패를 정확히 진단한다.
 *    서버가 500 을 뱉었는데 "이전 보고보다 적습니다"라고 말하면, 작업자는 맞는 숫자를
 *    틀렸다고 의심하고 고친다. 서버 장애를 입력 실수로 진단하는 셈이라 좋은 데이터를
 *    망가뜨리도록 유도한다. 무엇이 잘못됐는지 모를 때는 모른다고 말해야 한다.
 *
 * 2. 비가동 중에는 실제로 저장되지 않는다.
 *    입력칸이 안 보이는 것과 저장이 막히는 것은 다르다. 잠금 표시만 검증하면 잠금 자체가
 *    풀려도 테스트는 통과한다 — qty 는 lastReportedQty 로 초기화돼 있어 버튼이 살아나면
 *    제출이 그대로 나간다.
 *
 * 3. 다시 열면 최신 보고값이 들어온다.
 *    antd Modal 은 닫아도 언마운트되지 않으므로 useState 초기값은 첫 마운트에서 한 번만
 *    쓰인다. 그대로 두면 재오픈 시 옛 값이 고여 있고, 작업자가 그대로 저장하면 409 를 맞는다.
 *    단, 작업자가 이미 입력한 값은 폴링이 덮어쓰면 안 된다.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ProgressInputModal } from '../ProgressInputModal';

jest.mock('@/hooks/useTranslation', () => ({
  useProductionTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${JSON.stringify(vars)})` : key,
  }),
}));

const mockAuthFetch = jest.fn();
jest.mock('@/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => mockAuthFetch(...a) }));

const onClose = jest.fn();
const onSaved = jest.fn();

const baseProps = {
  open: true,
  machineId: '11111111-1111-4111-8111-111111111111',
  machineName: 'CNC-001',
  date: '2026-07-17',
  shift: 'A' as const,
  lastReportedQty: 60,
  downtimeSince: null,
  onClose,
  onSaved,
};

const input = () => screen.getByRole('spinbutton') as HTMLInputElement;
const submitButton = () => screen.getByText('progressInput.submit');
const flush = () => act(async () => { await Promise.resolve(); });

describe('ProgressInputModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthFetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ success: true }) });
  });

  it('입력값을 저장한다', async () => {
    render(<ProgressInputModal {...baseProps} />);
    fireEvent.change(input(), { target: { value: '150' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
    const [, init] = mockAuthFetch.mock.calls[0];
    expect(JSON.parse((init as { body: string }).body)).toEqual(
      expect.objectContaining({ shift_output_qty: 150, shift: 'A' })
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  // 비가동 중인 설비는 생산하지 않는다. 정상 전환 전까지 입력을 막는다.
  it('비가동 중이면 입력을 잠그고 경과를 알린다', () => {
    render(<ProgressInputModal {...baseProps} downtimeSince="2026-07-14T09:00:00+07:00" />);

    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(document.body.textContent).toContain('progressInput.downtimeLocked');
  });

  // 위 테스트는 잠금이 풀려도 통과한다 (입력칸이 없는 것도, 경고가 뜨는 것도 그대로다).
  // 잠금이 하는 일은 "저장이 안 나가는 것"이므로 그것을 직접 검증한다.
  it('비가동 중에는 저장 버튼을 눌러도 제출되지 않는다', async () => {
    render(<ProgressInputModal {...baseProps} downtimeSince="2026-07-14T09:00:00+07:00" />);

    fireEvent.click(submitButton());
    await flush();

    expect(mockAuthFetch).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  // Finding 3: 모달을 연 뒤 주기 자동갱신으로 shift props 가 A→B 로 바뀌면(편집값은 유지),
  // A조 값이 B조 첫 보고로 새지 않게 저장을 잠그고 경고한다.
  it('열린 뒤 교대가 바뀌면 저장을 잠그고 경고한다', async () => {
    const { rerender } = render(<ProgressInputModal {...baseProps} shift="A" />);
    fireEvent.change(input(), { target: { value: '50' } });

    rerender(<ProgressInputModal {...baseProps} shift="B" />); // 20:00 경계 넘어 교대 전환

    expect(document.body.textContent).toContain('progressInput.shiftChanged');
    fireEvent.click(submitButton());
    await flush();

    expect(mockAuthFetch).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  // 정상 경로: 저장 body 는 라이브 props 가 아니라 연 시점 스냅샷 교대로 나간다.
  it('저장은 연 시점 교대로 나간다', async () => {
    render(<ProgressInputModal {...baseProps} shift="A" />);
    fireEvent.change(input(), { target: { value: '50' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
    const [, init] = mockAuthFetch.mock.calls[0];
    expect(JSON.parse((init as { body: string }).body)).toEqual(
      expect.objectContaining({ shift: 'A', date: '2026-07-17' })
    );
  });

  it('서버가 감소를 거부하면 그 사실을 보여준다', async () => {
    mockAuthFetch.mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ error: 'shift_output_qty decreased', last_reported_qty: 150 }),
    });

    render(<ProgressInputModal {...baseProps} lastReportedQty={150} />);
    fireEvent.change(input(), { target: { value: '60' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(document.body.textContent).toContain('progressInput.decreasedError'));
    expect(onSaved).not.toHaveBeenCalled();
  });

  // Finding 6: 모달을 연 뒤 비가동이 시작되면 서버가 409 machine_in_downtime 으로 막는다.
  // 이걸 감소로 오진하면 작업자가 맞는 숫자를 의심한다 — 전용 메시지로 안내한다.
  it('서버가 비가동으로 거부하면(409 machine_in_downtime) 전용 메시지를 보여준다', async () => {
    mockAuthFetch.mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ error: 'machine_in_downtime', state: 'BREAKDOWN_REPAIR' }),
    });

    render(<ProgressInputModal {...baseProps} />);
    fireEvent.change(input(), { target: { value: '150' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(document.body.textContent).toContain('progressInput.downtimeServerRejected'));
    expect(document.body.textContent).not.toContain('progressInput.decreasedError');
    expect(onSaved).not.toHaveBeenCalled();
  });

  // 500 은 서버가 터진 것이지 작업자가 틀린 게 아니다. 감소라고 말하면 작업자는 맞는 숫자를
  // 고친다.
  it('저장이 실패하면 감소라고 말하지 않는다', async () => {
    mockAuthFetch.mockResolvedValue({
      ok: false, status: 500, json: async () => ({ error: 'Failed to save report' }),
    });

    render(<ProgressInputModal {...baseProps} />);
    fireEvent.change(input(), { target: { value: '150' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(document.body.textContent).toContain('progressInput.saveFailed'));
    expect(document.body.textContent).not.toContain('progressInput.decreasedError');
    expect(onSaved).not.toHaveBeenCalled();
  });

  // 네트워크 오류는 res.ok 분기까지 오지도 않는다 — authFetch 가 reject 한다. 잡지 않으면
  // 작업자는 아무 메시지도 못 보고 저장된 줄 안다.
  it('네트워크가 끊기면 실패를 알린다', async () => {
    mockAuthFetch.mockRejectedValue(new Error('network down'));

    render(<ProgressInputModal {...baseProps} />);
    fireEvent.change(input(), { target: { value: '150' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(document.body.textContent).toContain('progressInput.saveFailed'));
    expect(document.body.textContent).not.toContain('progressInput.decreasedError');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('닫았다 다시 열면 그동안 갱신된 마지막 보고값이 들어온다', () => {
    const { rerender } = render(<ProgressInputModal {...baseProps} lastReportedQty={60} />);
    expect(input().value).toBe('60');

    // 저장 후 닫힘 → 폴링이 최신값을 물어옴 → 작업자가 다시 엶
    rerender(<ProgressInputModal {...baseProps} open={false} lastReportedQty={60} />);
    rerender(<ProgressInputModal {...baseProps} open={false} lastReportedQty={150} />);
    rerender(<ProgressInputModal {...baseProps} open lastReportedQty={150} />);

    expect(input().value).toBe('150');
  });

  it('열려 있는 동안 폴링이 갱신하면 손대지 않은 입력칸은 따라간다', () => {
    const { rerender } = render(<ProgressInputModal {...baseProps} lastReportedQty={60} />);
    expect(input().value).toBe('60');

    rerender(<ProgressInputModal {...baseProps} lastReportedQty={150} />);

    expect(input().value).toBe('150');
  });

  // 위 동기화가 작업자의 입력을 덮으면 안 된다. 200 을 치는 중에 폴링이 150 으로 되돌리면
  // 작업자는 자기가 뭘 눌렀는지 알 수 없게 된다.
  it('작업자가 입력한 값은 폴링이 덮어쓰지 않는다', () => {
    const { rerender } = render(<ProgressInputModal {...baseProps} lastReportedQty={60} />);
    fireEvent.change(input(), { target: { value: '200' } });

    rerender(<ProgressInputModal {...baseProps} lastReportedQty={150} />);

    expect(input().value).toBe('200');
  });
});
