import React from 'react';
import { render, screen } from '@testing-library/react';
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

const MACHINE = '11111111-1111-4111-8111-111111111111';
const base = {
  machineId: MACHINE,
  date: '2026-07-28',
  shift: 'A' as const,
  onCorrected: () => {},
};

const rows: DowntimeBreakdownRow[] = [
  {
    id: 'de-1', source: 'downtime_entry', reason: 'endmillChange',
    start: '2026-07-28T02:12:00.000Z', end: '2026-07-28T02:30:00.000Z',
    minutes: 18, clipped_start: false,
  },
];

const state = (over: Record<string, unknown> = {}) => ({
  totalMinutes: 18, ongoingSince: null, intervals: rows,
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

  it('교대 창을 훅에 그대로 넘긴다 (스스로 추측하지 않는다)', () => {
    mockUseBreakdown.mockReturnValue(state());
    render(<DowntimeBreakdownCard {...base} />);
    expect(mockUseBreakdown).toHaveBeenCalledWith({
      machineId: MACHINE, date: '2026-07-28', shift: 'A',
    });
  });
});
