import {
  allocateDowntimeOwnership,
  buildDowntimeBreakdown,
  type DowntimeSourceRow,
} from '@/utils/downtimeBreakdown';
import { calculateDowntimeMinutesForWindow } from '@/app/api/production-records/daily/downtimeCalculation';
import type { Interval } from '@/utils/downtimeIntervals';

// A교대 2026-07-28 08:00~20:00 (Asia/Ho_Chi_Minh = UTC+7 → UTC 01:00~13:00)
const WINDOW: Interval = {
  start: Date.parse('2026-07-28T01:00:00.000Z'),
  end: Date.parse('2026-07-28T13:00:00.000Z'),
};
const NOW = Date.parse('2026-07-28T07:00:00.000Z'); // 교대 중간

const row = (over: Partial<DowntimeSourceRow> & { id: string }): DowntimeSourceRow => ({
  source: 'downtime_entry',
  reason: 'INSPECTION',
  start_time: '2026-07-28T02:00:00.000Z',
  end_time: '2026-07-28T02:30:00.000Z',
  ...over,
});

describe('buildDowntimeBreakdown', () => {
  it('andon 이중 기록(두 소스 같은 시간대)을 1행으로 접는다', () => {
    const rows = [
      row({ id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION' }),
      row({ id: 'ml-1', source: 'machine_log', reason: 'INSPECTION' }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('de-1');
    expect(out[0].source).toBe('downtime_entry');
    expect(out[0].minutes).toBe(30);
  });

  it('machine_logs 단독 정지는 살아남는다', () => {
    const rows = [
      row({ id: 'ml-1', source: 'machine_log', reason: 'TOOL_CHANGE' }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('machine_log');
    expect(out[0].minutes).toBe(30);
  });

  it('machine_logs 는 downtime_entries 가 덮지 않은 잔여만 소유한다', () => {
    const rows = [
      row({
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:30:00.000Z',
      }),
      row({
        id: 'ml-1', source: 'machine_log', reason: 'INSPECTION',
        start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:50:00.000Z',
      }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out).toHaveLength(2);
    expect(out.find(r => r.id === 'de-1')!.minutes).toBe(30);
    expect(out.find(r => r.id === 'ml-1')!.minutes).toBe(20);
  });

  it('먼저 시작한 downtime_entry 가 겹침을 소유한다', () => {
    const rows = [
      row({
        id: 'late', start_time: '2026-07-28T02:20:00.000Z', end_time: '2026-07-28T02:50:00.000Z',
      }),
      row({
        id: 'early', start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:30:00.000Z',
      }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out.find(r => r.id === 'early')!.minutes).toBe(30);
    expect(out.find(r => r.id === 'late')!.minutes).toBe(20);
  });

  it('완전히 가려진 행은 버린다 (0분 유령 행)', () => {
    const rows = [
      row({ id: 'outer', start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T03:00:00.000Z' }),
      row({ id: 'inner', start_time: '2026-07-28T02:10:00.000Z', end_time: '2026-07-28T02:20:00.000Z' }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out.map(r => r.id)).toEqual(['outer']);
  });

  it('시작 시각이 같으면 end_time = start_time 인 행은 애초에 제외된다', () => {
    const rows = [
      row({ id: 'ghost', start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:00:00.000Z' }),
    ];
    expect(buildDowntimeBreakdown(rows, WINDOW, NOW)).toEqual([]);
  });

  it('진행 중인 행은 end = null 이고 now 까지 계산한다', () => {
    const rows = [
      row({ id: 'open', start_time: '2026-07-28T06:00:00.000Z', end_time: null }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out[0].end).toBeNull();
    expect(out[0].minutes).toBe(60); // 06:00 → NOW 07:00
  });

  it('이전 교대에서 이어진 행은 교대 시작에 클립하고 clipped_start 를 세운다', () => {
    const rows = [
      row({
        id: 'carry', start_time: '2026-07-28T00:30:00.000Z', end_time: '2026-07-28T01:30:00.000Z',
      }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out[0].clipped_start).toBe(true);
    expect(out[0].start).toBe('2026-07-28T01:00:00.000Z');
    expect(out[0].minutes).toBe(30);
  });

  it('교대 창 밖의 행은 제외한다', () => {
    const rows = [
      row({ id: 'before', start_time: '2026-07-27T20:00:00.000Z', end_time: '2026-07-27T21:00:00.000Z' }),
    ];
    expect(buildDowntimeBreakdown(rows, WINDOW, NOW)).toEqual([]);
  });

  it('시작 시각 오름차순으로 정렬한다', () => {
    const rows = [
      row({ id: 'c', start_time: '2026-07-28T05:00:00.000Z', end_time: '2026-07-28T05:10:00.000Z' }),
      row({ id: 'a', start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:10:00.000Z' }),
      row({ id: 'b', start_time: '2026-07-28T03:00:00.000Z', end_time: '2026-07-28T03:10:00.000Z' }),
    ];
    expect(buildDowntimeBreakdown(rows, WINDOW, NOW).map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('불변조건: 배분된 시간의 합 = 합집합', () => {
  const cases: Array<{ name: string; rows: DowntimeSourceRow[] }> = [
    {
      name: 'andon 이중 기록',
      rows: [
        row({ id: 'de-1', source: 'downtime_entry' }),
        row({ id: 'ml-1', source: 'machine_log' }),
      ],
    },
    {
      name: '부분 겹침 3건 + machine_log 잔여',
      rows: [
        row({ id: 'a', start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:40:00.000Z' }),
        row({ id: 'b', start_time: '2026-07-28T02:30:00.000Z', end_time: '2026-07-28T03:10:00.000Z' }),
        row({ id: 'c', start_time: '2026-07-28T04:00:00.000Z', end_time: '2026-07-28T04:15:00.000Z' }),
        row({
          id: 'ml', source: 'machine_log',
          start_time: '2026-07-28T02:50:00.000Z', end_time: '2026-07-28T03:40:00.000Z',
        }),
      ],
    },
    {
      name: '진행 중 + 이전 교대 이월',
      rows: [
        row({ id: 'carry', start_time: '2026-07-28T00:30:00.000Z', end_time: '2026-07-28T01:30:00.000Z' }),
        row({ id: 'open', start_time: '2026-07-28T06:00:00.000Z', end_time: null }),
      ],
    },
  ];

  it.each(cases)('$name — 소유 구간의 ms 합이 합집합 ms 와 정확히 같다', ({ rows }) => {
    const owned = allocateDowntimeOwnership(rows, WINDOW, NOW);
    const allocatedMs = owned.reduce(
      (sum, item) => sum + item.owned.reduce((s, i) => s + (i.end - i.start), 0),
      0
    );
    const unionMinutes = calculateDowntimeMinutesForWindow(
      rows.map(r => ({ start_time: r.start_time, end_time: r.end_time })),
      WINDOW,
      NOW
    );
    expect(allocatedMs / 60000).toBeCloseTo(unionMinutes, 6);
  });

  it('소유 구간끼리는 서로 겹치지 않는다', () => {
    const rows = cases[1].rows;
    const all = allocateDowntimeOwnership(rows, WINDOW, NOW)
      .flatMap(item => item.owned)
      .sort((l, r) => l.start - r.start);
    for (let i = 1; i < all.length; i++) {
      expect(all[i].start).toBeGreaterThanOrEqual(all[i - 1].end);
    }
  });
});
