import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DowntimeBreakdownCard } from '../DowntimeBreakdownCard';
import type { DowntimeBreakdownRow } from '@/utils/downtimeBreakdown';

const mockUseBreakdown = jest.fn();
jest.mock('@/hooks/useDowntimeBreakdown', () => ({
  useDowntimeBreakdown: (...a: unknown[]) => mockUseBreakdown(...a),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useMultipleTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // 실제 i18next 처럼 defaultValue 를 존중해야 한다. resolveDowntimeReasonLabel 이
      // 바로 그 값으로 "사전에 키가 없음"을 감지하기 때문이다. 무시하면 라벨이 항상
      // 'machines:states.X|...' 로 나와, 사유 관련 단언이 거짓 통과/실패한다.
      if (opts && 'defaultValue' in opts) return opts.defaultValue as string;
      if (!opts) return key;
      // 보간값을 뒤에 이어 붙여 어떤 값으로 렌더됐는지 확인할 수 있게 한다.
      return `${key}(${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')})`;
    },
    i18n: { language: 'ko' },
    language: 'ko',
    changeLanguage: () => {},
  }),
}));

const mockAuthFetch = jest.fn();
jest.mock('@/lib/authFetch', () => ({
  authFetch: (...a: unknown[]) => mockAuthFetch(...a),
}));

const MACHINE = '11111111-1111-4111-8111-111111111111';
const base = {
  machineId: MACHINE,
  date: '2026-07-28',
  onCorrected: () => {},
};

const SHIFT_TOTALS = {
  day: { minutes: 12, start: '2026-07-28T01:00:00.000Z', end: '2026-07-28T13:00:00.000Z' },
  night: { minutes: 6, start: '2026-07-28T13:00:00.000Z', end: '2026-07-29T01:00:00.000Z' },
};

// 카드가 쓰는 것과 같은 규칙으로 기대값을 만든다 — 테스트 실행 환경의 로컬 타임존이
// 무엇이든(고정 안 되어 있음) 하드코딩한 "10:00" 같은 문자열과 어긋나지 않게 한다.
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

const rows: DowntimeBreakdownRow[] = [
  {
    id: 'de-1', source: 'downtime_entry', reason: 'endmillChange',
    start: '2026-07-28T02:12:00.000Z', end: '2026-07-28T02:30:00.000Z',
    minutes: 18, clipped_start: false,
  },
];

const state = (over: Record<string, unknown> = {}) => ({
  totalMinutes: 18, shiftTotals: SHIFT_TOTALS, ongoingSince: null, intervals: rows,
  loaded: true, loading: false, error: null,
  refresh: jest.fn(), ...over,
});

describe('DowntimeBreakdownCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('누적 분이 null 이면 0 이 아니라 계산 보류로 표시한다', () => {
    mockUseBreakdown.mockReturnValue(state({ totalMinutes: null }));
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.getByText(/cumulativeUnknown/)).toBeInTheDocument();
    expect(screen.queryByText(/cumulative\(/)).not.toBeInTheDocument();
  });

  // 2026-07-28 브라우저 확인에서 발견: 조회 전에도 totalMinutes 가 null 이라, 로딩 중
  // 화면에 "계획정지와 휴식이 겹쳐 계산을 보류했습니다"라는 **있지도 않은 이유**가 떴다.
  // null 에 겹쳐 있는 세 뜻(조회 전 / 실패 / 계산 보류)을 loaded 로 갈라야 한다.
  it('아직 조회 전이면 계산 보류 사유를 단정하지 않는다', () => {
    mockUseBreakdown.mockReturnValue(state({ totalMinutes: null, loaded: false, error: null }));
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.getByText(/cumulativeUnknown/)).toBeInTheDocument();
    expect(screen.queryByText(/cumulativeUnknownHint/)).not.toBeInTheDocument();
  });

  it('조회를 마친 뒤의 null 에만 계산 보류 사유를 붙인다', () => {
    mockUseBreakdown.mockReturnValue(state({ totalMinutes: null, loaded: true }));
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.getByText(/cumulativeUnknownHint/)).toBeInTheDocument();
  });

  // 2026-07-28 브라우저 확인에서 발견: 서버 total_minutes 는 소수 2자리(119.64)를 유지하는데
  // 건별 행은 정수(120)라, 같은 시간이 두 숫자로 보여 사용자가 계산 오류로 읽었다.
  it('누적 분은 정수로 표시한다 (행과 같은 반올림 규칙)', () => {
    mockUseBreakdown.mockReturnValue(state({ totalMinutes: 119.64 }));
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.getByText(/minutes=120/)).toBeInTheDocument();
    expect(screen.queryByText(/119\.64/)).not.toBeInTheDocument();
  });

  it('조회에 실패하면 "0건"이 아니라 오류를 보여준다', () => {
    mockUseBreakdown.mockReturnValue(
      state({ loaded: false, error: 'HTTP 500', intervals: [], totalMinutes: null })
    );
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.getByText(/loadFailed/)).toBeInTheDocument();
    expect(screen.queryByText(/downtimeBreakdown\.empty/)).not.toBeInTheDocument();
  });

  it('조회에 성공했고 0건이면 비가동 없음을 보여준다', () => {
    mockUseBreakdown.mockReturnValue(state({ intervals: [], totalMinutes: 0 }));
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.getByText(/downtimeBreakdown\.empty/)).toBeInTheDocument();
  });

  it('진행 중이면 경과 시간을 보여준다', () => {
    mockUseBreakdown.mockReturnValue(state({
      ongoingSince: '2026-07-28T06:00:00.000Z',
      intervals: [{
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start: '2026-07-28T06:00:00.000Z', end: null,
        minutes: 23, clipped_start: false,
      }],
    }));
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.getByText(/elapsedNow/)).toBeInTheDocument();
  });

  it('진행 중인 비가동이 없으면 경과 배너를 그리지 않는다', () => {
    mockUseBreakdown.mockReturnValue(state());  // ongoingSince: null
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.queryByText(/elapsedNow/)).not.toBeInTheDocument();
  });

  it('이전 교대에서 이어진 비가동은 클립된 start 가 아니라 ongoingSince 로 경과를 잰다', () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-28T02:00:00.000Z'));
    mockUseBreakdown.mockReturnValue(state({
      // 실제 시작 00:30, 목록의 start 는 교대 시작 01:00 으로 클립됨
      ongoingSince: '2026-07-28T00:30:00.000Z',
      intervals: [{
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start: '2026-07-28T01:00:00.000Z', end: null,
        minutes: 60, clipped_start: true,
      }],
    }));
    render(<DowntimeBreakdownCard {...base} />);
    // 00:30 → 02:00 = 90분. 클립된 01:00 기준이면 60분(hours=1,minutes=0)이 나온다.
    expect(screen.getByText(/hours=1,minutes=30/)).toBeInTheDocument();
    (Date.now as jest.Mock).mockRestore();
  });

  it('건별 목록에 사유 라벨을 그린다', () => {
    mockUseBreakdown.mockReturnValue(state());
    render(<DowntimeBreakdownCard {...base} />);
    // 모의 사전이 비어 있으므로 resolveDowntimeReasonLabel 은 원본 코드를 돌려준다
    expect(screen.getByText('endmillChange')).toBeInTheDocument();
  });

  it('업무일을 훅에 그대로 넘긴다 (스스로 추측하지 않는다)', () => {
    mockUseBreakdown.mockReturnValue(state());
    render(<DowntimeBreakdownCard {...base} />);
    expect(mockUseBreakdown).toHaveBeenCalledWith({
      machineId: MACHINE, date: '2026-07-28',
    });
  });

  // 2026-07-28 브라우저 확인에서 발견: andon 으로 비가동을 시작해도 카드가 그대로 남아
  // "비가동 중" 배너 옆에서 누적이 안 변했다. 카드와 andon 은 형제라 서로를 모르고
  // 카드의 훅에는 자체 폴링이 없어서, 상위가 토큰을 올려 알려 주는 것이 유일한 경로다.
  it('refreshToken 이 바뀌면 재조회한다 (andon 이 상태를 바꿨을 때의 유일한 갱신 경로)', () => {
    const refresh = jest.fn();
    mockUseBreakdown.mockReturnValue(state({ refresh }));
    const { rerender } = render(<DowntimeBreakdownCard {...base} refreshToken={0} />);
    // 마운트 조회는 훅이 한다 — 토큰 때문에 중복 호출하면 안 된다.
    expect(refresh).not.toHaveBeenCalled();

    rerender(<DowntimeBreakdownCard {...base} refreshToken={1} />);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('같은 refreshToken 으로 리렌더되면 재조회하지 않는다', () => {
    const refresh = jest.fn();
    mockUseBreakdown.mockReturnValue(state({ refresh }));
    const { rerender } = render(<DowntimeBreakdownCard {...base} refreshToken={7} />);
    rerender(<DowntimeBreakdownCard {...base} refreshToken={7} />);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('주간/야간 소계를 shiftTotals 의 시각과 분으로 그린다 (하드코딩하지 않는다)', () => {
    mockUseBreakdown.mockReturnValue(state({ shiftTotals: SHIFT_TOTALS }));
    render(<DowntimeBreakdownCard {...base} />);
    const dayFrom = clock(SHIFT_TOTALS.day.start);
    const dayTo = clock(SHIFT_TOTALS.day.end);
    const nightFrom = clock(SHIFT_TOTALS.night.start);
    const nightTo = clock(SHIFT_TOTALS.night.end);
    expect(screen.getByText(new RegExp(
      `shiftTotalDay\\(from=${dayFrom},to=${dayTo},minutes=downtimeBreakdown\\.minutesShort\\(minutes=12\\)\\)`
    ))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(
      `shiftTotalNight\\(from=${nightFrom},to=${nightTo},minutes=downtimeBreakdown\\.minutesShort\\(minutes=6\\)\\)`
    ))).toBeInTheDocument();
  });

  it('소계가 null 이면 숫자 대신 대시를 그린다 ("모름" ≠ "0분")', () => {
    mockUseBreakdown.mockReturnValue(state({
      shiftTotals: {
        day: { ...SHIFT_TOTALS.day, minutes: null },
        night: SHIFT_TOTALS.night,
      },
    }));
    render(<DowntimeBreakdownCard {...base} />);
    const dayFrom = clock(SHIFT_TOTALS.day.start);
    const dayTo = clock(SHIFT_TOTALS.day.end);
    expect(screen.getByText(new RegExp(
      `shiftTotalDay\\(from=${dayFrom},to=${dayTo},minutes=—\\)`
    ))).toBeInTheDocument();
  });

  it('shiftTotals 가 아직 없으면 소계 줄을 그리지 않는다', () => {
    mockUseBreakdown.mockReturnValue(state({ shiftTotals: null }));
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.queryByText(/shiftTotalDay/)).not.toBeInTheDocument();
    expect(screen.queryByText(/shiftTotalNight/)).not.toBeInTheDocument();
  });

  // A/B 는 이 시스템에서 근무조가 아니라 시간대인데 현장은 조 이름으로 읽는다 —
  // 그래서 화면 라벨에서 A/B 글자를 아예 뺐다. 회귀를 막는 가드.
  it('주간/야간 소계에 A교대/B교대 같은 A/B 라벨을 쓰지 않는다', () => {
    mockUseBreakdown.mockReturnValue(state({ shiftTotals: SHIFT_TOTALS }));
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.queryByText(/A교대/)).not.toBeInTheDocument();
    expect(screen.queryByText(/B교대/)).not.toBeInTheDocument();
  });
});

describe('DowntimeBreakdownCard 사유 정정', () => {
  const ongoing: DowntimeBreakdownRow[] = [
    {
      id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
      start: '2026-07-28T06:00:00.000Z', end: null,
      minutes: 23, clipped_start: false,
    },
  ];
  const downState = (over: Record<string, unknown> = {}) => state({
    intervals: ongoing,
    totalMinutes: 23,
    ongoingSince: '2026-07-28T06:00:00.000Z',
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  });

  it('allowCorrection 이 없으면 정정 버튼을 그리지 않는다', () => {
    mockUseBreakdown.mockReturnValue(downState());
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.queryByText(/downtimeBreakdown\.correct$/)).not.toBeInTheDocument();
  });

  it('종료된 건에는 정정 버튼을 그리지 않는다', () => {
    mockUseBreakdown.mockReturnValue(state());  // rows[0].end 가 채워져 있다
    render(<DowntimeBreakdownCard {...base} allowCorrection />);
    expect(screen.queryByText(/downtimeBreakdown\.correct$/)).not.toBeInTheDocument();
  });

  it('진행 중인 건의 정정 버튼을 누르면 사유 선택이 열린다', () => {
    mockUseBreakdown.mockReturnValue(downState());
    render(<DowntimeBreakdownCard {...base} allowCorrection />);
    fireEvent.click(screen.getByText(/downtimeBreakdown\.correct$/));
    expect(screen.getByText(/downtimeBreakdown\.correctTitle/)).toBeInTheDocument();
  });

  it('현재 사유는 선택지에서 제외한다', () => {
    mockUseBreakdown.mockReturnValue(downState());
    render(<DowntimeBreakdownCard {...base} allowCorrection />);
    fireEvent.click(screen.getByText(/downtimeBreakdown\.correct$/));
    // 진행 중인 건의 사유가 INSPECTION 이므로 그 **선택 버튼**은 없다.
    // 반드시 role=button 으로 범위를 좁힌다. 목록 행이 그 사유 라벨을 <Text>INSPECTION</Text>
    // 로 그대로 렌더하므로(그게 이 기능의 목적이다), 문서 전체에서 찾으면 버튼이 올바로
    // 제외됐는데도 행에 걸려 영원히 실패한다.
    expect(screen.queryByRole('button', { name: 'INSPECTION' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'BREAKDOWN_REPAIR' })).toBeInTheDocument();
  });

  it('사유를 고르면 PATCH 를 보내고 상위에 알린다', async () => {
    const onCorrected = jest.fn();
    const refresh = jest.fn();
    mockUseBreakdown.mockReturnValue(downState({ refresh }));
    render(<DowntimeBreakdownCard {...base} allowCorrection onCorrected={onCorrected} />);

    fireEvent.click(screen.getByText(/downtimeBreakdown\.correct$/));
    fireEvent.click(screen.getByText('BREAKDOWN_REPAIR'));

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledWith(
        `/api/machines/${MACHINE}/downtime`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ reason: 'BREAKDOWN_REPAIR' }),
        })
      );
    });
    await waitFor(() => expect(onCorrected).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('정정에 실패하면 오류를 보여주고 상위에 성공을 알리지 않는다', async () => {
    const onCorrected = jest.fn();
    mockAuthFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'not_in_downtime' }) });
    mockUseBreakdown.mockReturnValue(downState());
    render(<DowntimeBreakdownCard {...base} allowCorrection onCorrected={onCorrected} />);

    fireEvent.click(screen.getByText(/downtimeBreakdown\.correct$/));
    fireEvent.click(screen.getByText('BREAKDOWN_REPAIR'));

    await waitFor(() => expect(screen.getByText(/correctNotInDowntime/)).toBeInTheDocument());
    expect(onCorrected).not.toHaveBeenCalled();
  });
});
