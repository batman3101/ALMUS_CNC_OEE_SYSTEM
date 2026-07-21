import {
  SHIFT_BREAK_WINDOWS,
  TOTAL_BREAK_MINUTES,
  elapsedBreakMinutes,
} from '../shiftBreaks';

// 교대 시작 시각. B 교대는 date 당일 20:00 에 시작해 다음날 08:00 에 끝난다.
const shiftAStart = (d = '2026-07-17') => new Date(`${d}T08:00:00+07:00`);
const shiftBStart = (d = '2026-07-17') => new Date(`${d}T20:00:00+07:00`);
const at = (iso: string) => new Date(iso);

describe('shiftBreaks', () => {
  // system_settings(category='shift').break_time_minutes = 110 (운영 실측).
  // 시간대 합계가 이 값과 어긋나면 실시간 화면과 확정 OEE 가 서로 다른 말을 한다.
  it('A/B 교대 휴식 합계가 총량 110분과 일치한다', () => {
    expect(TOTAL_BREAK_MINUTES).toBe(110);
    for (const shift of ['A', 'B'] as const) {
      const sum = SHIFT_BREAK_WINDOWS[shift].reduce((n, w) => n + w.durationMinutes, 0);
      expect(sum).toBe(TOTAL_BREAK_MINUTES);
    }
  });

  it('A 교대: 10:00 시점에 09:50~10:00 만 지났다', () => {
    expect(elapsedBreakMinutes('A', shiftAStart(), at('2026-07-17T10:00:00+07:00'))).toBe(10);
  });

  it('A 교대: 09:55 시점에는 휴식이 절반만 지났다', () => {
    expect(elapsedBreakMinutes('A', shiftAStart(), at('2026-07-17T09:55:00+07:00'))).toBe(5);
  });

  it('A 교대: 교대 시작 직후엔 0분', () => {
    expect(elapsedBreakMinutes('A', shiftAStart(), at('2026-07-17T08:00:00+07:00'))).toBe(0);
  });

  it('A 교대: 종료 시각엔 총량이 모두 지났다', () => {
    expect(elapsedBreakMinutes('A', shiftAStart(), at('2026-07-17T20:00:00+07:00'))).toBe(110);
  });

  // 교대 후반을 표본으로 잡지 않으면 3·4번 휴식의 위치가 아무 테스트에도 고정되지 않는다.
  // (종료 시점 테스트는 위치가 아니라 "모든 휴식이 교대 안에 들어간다"는 불변식을 지킨다 —
  //  둘 다 필요하다.)
  it('A 교대: 14:55 시점에 3번 휴식이 절반 지났다', () => {
    // 10(09:50~10:00) + 60(11:20~12:20) + 5(14:50~14:55 경과분)
    expect(elapsedBreakMinutes('A', shiftAStart(), at('2026-07-17T14:55:00+07:00'))).toBe(75);
  });

  it('A 교대: 17:45 시점에 4번 휴식이 절반 지났다', () => {
    // 10 + 60 + 10 + 15(17:30~17:45 경과분)
    expect(elapsedBreakMinutes('A', shiftAStart(), at('2026-07-17T17:45:00+07:00'))).toBe(95);
  });

  // B 교대의 23:20~00:20 은 자정을 넘는다. 이 프로젝트에서 자정 경계는 반복된 함정이다.
  it('B 교대: 자정을 넘는 휴식(23:20~00:20)을 절반만 지난 시점', () => {
    expect(elapsedBreakMinutes('B', shiftBStart(), at('2026-07-17T23:50:00+07:00'))).toBe(10 + 30);
  });

  it('B 교대: 자정 넘긴 00:20 에 그 구간이 끝난다', () => {
    expect(elapsedBreakMinutes('B', shiftBStart(), at('2026-07-18T00:20:00+07:00'))).toBe(10 + 60);
  });

  it('B 교대: 다음날 08:00 종료 시 총량이 모두 지났다', () => {
    expect(elapsedBreakMinutes('B', shiftBStart(), at('2026-07-18T08:00:00+07:00'))).toBe(110);
  });

  it('유효하지 않은 Date 는 0 으로 뭉개지 않고 throw 한다', () => {
    expect(() => elapsedBreakMinutes('A', new Date('nope'), at('2026-07-17T10:00:00+07:00'))).toThrow();
  });

  it('교대 시작 전(시계 오차)은 0 이다', () => {
    expect(elapsedBreakMinutes('A', shiftAStart(), at('2026-07-17T07:30:00+07:00'))).toBe(0);
  });
});
