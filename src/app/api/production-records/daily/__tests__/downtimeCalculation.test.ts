import {
  calculateDowntimeMinutesForWindow,
  calculateVerifiedDowntimeMinutesForWindow,
  resolveConfirmedDowntimeMinutes,
} from '../downtimeCalculation';

describe('daily production downtime calculation', () => {
  const hour = 60 * 60 * 1000;

  it('uses the union of manual and machine events instead of summing overlaps twice', () => {
    const window = { start: 0, end: 12 * hour };
    const result = calculateDowntimeMinutesForWindow([
      { start_time: new Date(1 * hour).toISOString(), end_time: new Date(3 * hour).toISOString() },
      { start_time: new Date(2 * hour).toISOString(), end_time: new Date(4 * hour).toISOString() },
    ], window, 12 * hour);

    expect(result).toBe(180);
  });

  it('clips an ongoing event to the current time inside the shift', () => {
    const window = { start: 0, end: 12 * hour };
    const result = calculateDowntimeMinutesForWindow([
      { start_time: new Date(10 * hour).toISOString(), end_time: null },
    ], window, 11 * hour);

    expect(result).toBe(60);
  });

  it('clips a previous-day event to the requested shift boundary', () => {
    const window = { start: 8 * hour, end: 20 * hour };
    const result = calculateDowntimeMinutesForWindow([
      { start_time: new Date(6 * hour).toISOString(), end_time: new Date(10 * hour).toISOString() },
    ], window, 20 * hour);

    expect(result).toBe(120);
  });
});

describe('daily production zero-downtime confirmation', () => {
  it('keeps an empty unconfirmed shift unknown', () => {
    expect(resolveConfirmedDowntimeMinutes(0, false)).toBeNull();
  });

  it('accepts an explicitly confirmed zero-downtime shift', () => {
    expect(resolveConfirmedDowntimeMinutes(0, true)).toBe(0);
  });

  it('accepts measured downtime without a separate zero confirmation', () => {
    expect(resolveConfirmedDowntimeMinutes(35, false)).toBe(35);
  });

  it('never converts a failed source read into confirmed zero', () => {
    expect(resolveConfirmedDowntimeMinutes(null, true)).toBeNull();
  });
});

describe('planned break overlap safety', () => {
  const hour = 60 * 60 * 1000;
  const window = { start: 0, end: 12 * hour };

  it('keeps OEE downtime unknown when planned stop can overlap an aggregate break', () => {
    expect(calculateVerifiedDowntimeMinutesForWindow([
      {
        start_time: new Date(3 * hour).toISOString(),
        end_time: new Date(4 * hour).toISOString(),
        is_planned: true,
      },
    ], window, 60, 12 * hour)).toBeNull();
  });

  it('still calculates unplanned downtime with an aggregate break configured', () => {
    expect(calculateVerifiedDowntimeMinutesForWindow([
      {
        start_time: new Date(3 * hour).toISOString(),
        end_time: new Date(4 * hour).toISOString(),
        is_planned: false,
      },
    ], window, 60, 12 * hour)).toBe(60);
  });
});
