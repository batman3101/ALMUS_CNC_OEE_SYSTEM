import {
  allocateDowntimeIntervals,
  buildBusinessRange,
  buildShiftWindows,
  clipInterval,
  totalMinutes,
  type DowntimeIntervalEntry,
} from '@/utils/downtimeIntervals';

const HOUR = 60 * 60 * 1000;

const at = (iso: string): number => new Date(iso).getTime();

describe('downtime business-day windows', () => {
  test('a single business day includes B shift through next-day 08:00', () => {
    const range = buildBusinessRange(
      '2026-07-15',
      '2026-07-15',
      'Asia/Ho_Chi_Minh',
      '08:00'
    );

    expect(range).toEqual({
      start: at('2026-07-15T08:00:00+07:00'),
      end: at('2026-07-16T08:00:00+07:00'),
    });

    const bWindows = buildShiftWindows({
      startDate: '2026-07-15',
      endDate: '2026-07-15',
      timezone: 'Asia/Ho_Chi_Minh',
      shiftAStart: '08:00',
      shiftBStart: '20:00',
      requestedShifts: ['B'],
    });

    expect(bWindows).toEqual([
      {
        start: at('2026-07-15T20:00:00+07:00'),
        end: at('2026-07-16T08:00:00+07:00'),
      },
    ]);
    expect(totalMinutes(bWindows)).toBe(720);
  });

  test('clips a 23:30-01:30 event to the B-shift window without losing post-midnight time', () => {
    const [bWindow] = buildShiftWindows({
      startDate: '2026-07-15',
      endDate: '2026-07-15',
      timezone: 'Asia/Ho_Chi_Minh',
      shiftAStart: '08:00',
      shiftBStart: '20:00',
      requestedShifts: ['B'],
    });

    expect(
      totalMinutes(
        clipInterval(
          {
            start: at('2026-07-15T23:30:00+07:00'),
            end: at('2026-07-16T01:30:00+07:00'),
          },
          [bWindow]
        )
      )
    ).toBe(120);
  });

  test('clips an ongoing event that began before the requested business day', () => {
    const range = buildBusinessRange(
      '2026-07-15',
      '2026-07-15',
      'Asia/Ho_Chi_Minh',
      '08:00'
    );

    expect(
      totalMinutes(
        clipInterval(
          {
            start: at('2026-07-14T18:00:00+07:00'),
            end: at('2026-07-15T11:00:00+07:00'),
          },
          [range]
        )
      )
    ).toBe(180);
  });

  test.each([
    ['two consecutive days', '2026-07-15', '2026-07-16', 48],
    ['month end', '2026-07-31', '2026-08-01', 48],
    ['year end', '2026-12-31', '2027-01-01', 48],
  ])('%s keeps A+B equal to the complete business range', (_name, startDate, endDate, hours) => {
    const all = buildShiftWindows({
      startDate,
      endDate,
      timezone: 'Asia/Ho_Chi_Minh',
      shiftAStart: '08:00',
      shiftBStart: '20:00',
      requestedShifts: ['A', 'B'],
    });
    const onlyA = buildShiftWindows({
      startDate,
      endDate,
      timezone: 'Asia/Ho_Chi_Minh',
      shiftAStart: '08:00',
      shiftBStart: '20:00',
      requestedShifts: ['A'],
    });
    const onlyB = buildShiftWindows({
      startDate,
      endDate,
      timezone: 'Asia/Ho_Chi_Minh',
      shiftAStart: '08:00',
      shiftBStart: '20:00',
      requestedShifts: ['B'],
    });

    expect(totalMinutes(all)).toBe(hours * 60);
    expect(totalMinutes(onlyA) + totalMinutes(onlyB)).toBe(totalMinutes(all));
  });
});

describe('manual downtime overlap allocation', () => {
  const entry = (
    id: string,
    startHour: number,
    endHour: number,
    overrides: Partial<DowntimeIntervalEntry> = {}
  ): DowntimeIntervalEntry => ({
    id,
    machineId: 'machine-1',
    businessDate: '2026-07-15',
    shift: 'A',
    start: startHour * HOUR,
    end: endHour * HOUR,
    ...overrides,
  });

  test('partially overlapping entries total the union and assign overlap to the earlier entry', () => {
    const allocated = allocateDowntimeIntervals([
      entry('first', 10, 11),
      entry('second', 10.5, 11.5),
    ]);

    expect(allocated.map(row => [row.id, totalMinutes(row.intervals)])).toEqual([
      ['first', 60],
      ['second', 30],
    ]);
  });

  test('a fully nested entry contributes no duplicate minutes', () => {
    const allocated = allocateDowntimeIntervals([
      entry('outer', 10, 12),
      entry('inner', 10.5, 11),
    ]);

    expect(allocated.map(row => [row.id, totalMinutes(row.intervals)])).toEqual([
      ['outer', 120],
      ['inner', 0],
    ]);
  });

  test('touching entries retain all minutes without overlap', () => {
    const allocated = allocateDowntimeIntervals([
      entry('first', 10, 11),
      entry('second', 11, 12),
    ]);

    expect(allocated.reduce((sum, row) => sum + totalMinutes(row.intervals), 0)).toBe(120);
  });

  test('different machines or shifts are allocated independently', () => {
    const allocated = allocateDowntimeIntervals([
      entry('machine-1-A', 10, 11),
      entry('machine-2-A', 10, 11, { machineId: 'machine-2' }),
      entry('machine-1-B', 10, 11, { shift: 'B' }),
    ]);

    expect(allocated.map(row => totalMinutes(row.intervals))).toEqual([60, 60, 60]);
  });
});
