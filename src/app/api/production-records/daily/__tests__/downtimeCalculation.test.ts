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

describe('daily production zero-downtime resolution', () => {
  // 현장은 비가동이 발생했을 때만 기록한다. "없었음"을 매 교대 확인하게 하면
  // 지켜지지 않고, 정상 가동 설비가 OEE 미계산(NULL)으로 남는다.
  it('treats an empty shift as genuinely zero downtime', () => {
    expect(resolveConfirmedDowntimeMinutes(0)).toBe(0);
  });

  it('passes measured downtime through', () => {
    expect(resolveConfirmedDowntimeMinutes(35)).toBe(35);
  });

  // "0건 조회됨"과 "조회 못함"은 다르다. 후자를 0 으로 단정하면 데이터 조작이다.
  it('never converts a failed source read into zero', () => {
    expect(resolveConfirmedDowntimeMinutes(null)).toBeNull();
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
