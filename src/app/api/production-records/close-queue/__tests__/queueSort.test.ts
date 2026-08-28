import {
  DEFAULT_QUEUE_SORT,
  InvalidQueueSortError,
  buildQueueComparator,
  parseQueueSort,
  type QueueItemLike
} from '../queueSort';

const item = (
  machine_name: string,
  date: string,
  shift: 'A' | 'B',
  last_qty: number | null,
  machine_id = machine_name.toLowerCase()
): QueueItemLike => ({ machine_id, machine_name, date, shift, last_qty });

const ITEMS: QueueItemLike[] = [
  item('CNC-03', '2026-08-02', 'B', 120),
  item('CNC-01', '2026-08-01', 'A', 340),
  item('CNC-02', '2026-08-02', 'A', null),
  item('CNC-01', '2026-08-02', 'A', 90)
];

const sorted = (field: Parameters<typeof buildQueueComparator>[0], dir: 'asc' | 'desc') =>
  [...ITEMS].sort(buildQueueComparator(field, dir));

describe('parseQueueSort', () => {
  it('파라미터가 없으면 오래된 교대 먼저 — 기존 동작', () => {
    expect(parseQueueSort(null, null)).toEqual(DEFAULT_QUEUE_SORT);
    expect(DEFAULT_QUEUE_SORT).toEqual({ field: 'date', direction: 'asc' });
  });

  it('허용 목록 밖은 거절한다', () => {
    expect(() => parseQueueSort('final_qty', null)).toThrow(InvalidQueueSortError);
    expect(() => parseQueueSort('date', 'up')).toThrow(InvalidQueueSortError);
  });
});

describe('buildQueueComparator', () => {
  it('기본(날짜 오름차순)은 기존 순서를 그대로 재현한다', () => {
    // 기존 코드: date asc → shift(A<B) → machine_name
    expect(sorted('date', 'asc').map(i => `${i.date}/${i.shift}/${i.machine_name}`)).toEqual([
      '2026-08-01/A/CNC-01',
      '2026-08-02/A/CNC-01',
      '2026-08-02/A/CNC-02',
      '2026-08-02/B/CNC-03'
    ]);
  });

  it('설비명으로 정렬한다', () => {
    expect(sorted('machine_name', 'asc').map(i => i.machine_name))
      .toEqual(['CNC-01', 'CNC-01', 'CNC-02', 'CNC-03']);
    expect(sorted('machine_name', 'desc').map(i => i.machine_name))
      .toEqual(['CNC-03', 'CNC-02', 'CNC-01', 'CNC-01']);
  });

  it('진척 수량으로 정렬하고, 미기록(null)은 방향과 무관하게 맨 뒤', () => {
    expect(sorted('last_qty', 'asc').map(i => i.last_qty)).toEqual([90, 120, 340, null]);
    expect(sorted('last_qty', 'desc').map(i => i.last_qty)).toEqual([340, 120, 90, null]);
  });

  it('교대는 라벨이 아니라 A→B 순서로 정렬한다', () => {
    expect(sorted('shift', 'asc').map(i => i.shift)).toEqual(['A', 'A', 'A', 'B']);
    expect(sorted('shift', 'desc').map(i => i.shift)).toEqual(['B', 'A', 'A', 'A']);
  });

  it('어떤 정렬에서도 동점이 남지 않는다 — 폴링 중 행이 튀지 않으려면 전순서라야 한다', () => {
    for (const field of ['machine_name', 'date', 'shift', 'last_qty'] as const) {
      for (const dir of ['asc', 'desc'] as const) {
        const cmp = buildQueueComparator(field, dir);
        for (const a of ITEMS) {
          for (const b of ITEMS) {
            if (a.machine_id === b.machine_id && a.date === b.date && a.shift === b.shift) continue;
            expect(cmp(a, b)).not.toBe(0);
          }
        }
      }
    }
  });
});
