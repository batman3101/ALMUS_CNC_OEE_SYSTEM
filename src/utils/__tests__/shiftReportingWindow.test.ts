import { classifyReportingWindow } from '../shiftReportingWindow';

/**
 * Codex 감사 2026-07-29 #5 회귀 검사 — 진행 보고를 받아도 되는 교대인지의 판정 규칙.
 *
 * 경계값이 이 규칙의 전부라서 경계만 집중해서 본다. 특히 `end` 시각 정각은 "교대는 끝났지만
 * 유예 안" 이라 **열려 있어야** 한다 — 종료 직전에 보고를 시작한 작업자가 몇 초 늦었다고
 * 거부당하면 그 가드는 결국 우회된다.
 */

// 2026-07-29 A교대(현지 08:00~20:00, UTC+7) 를 epoch ms 로.
const A_START = Date.parse('2026-07-29T01:00:00.000Z'); // 현지 08:00
const A_END = Date.parse('2026-07-29T13:00:00.000Z');   // 현지 20:00
const A_SHIFT = { start: A_START, end: A_END };

const MINUTE = 60_000;

describe('classifyReportingWindow', () => {
  it('교대 시작 전이면 not_started', () => {
    expect(classifyReportingWindow(A_SHIFT, 10, A_START - 1)).toBe('not_started');
  });

  it('교대 시작 정각은 열려 있다', () => {
    expect(classifyReportingWindow(A_SHIFT, 10, A_START)).toBe('open');
  });

  it('교대 중이면 열려 있다', () => {
    expect(classifyReportingWindow(A_SHIFT, 10, A_START + 6 * 60 * MINUTE)).toBe('open');
  });

  it('교대 종료 정각은 아직 열려 있다 (유예가 뒤를 덮는다)', () => {
    expect(classifyReportingWindow(A_SHIFT, 10, A_END)).toBe('open');
  });

  it('유예 안이면 열려 있다', () => {
    expect(classifyReportingWindow(A_SHIFT, 10, A_END + 10 * MINUTE - 1)).toBe('open');
  });

  it('유예가 끝나는 순간 닫힌다', () => {
    expect(classifyReportingWindow(A_SHIFT, 10, A_END + 10 * MINUTE)).toBe('closed');
  });

  it('한참 지난 과거 교대는 닫혀 있다 — 과거 실적 오염 경로를 막는다', () => {
    const thirtyDaysLater = A_END + 30 * 24 * 60 * MINUTE;
    expect(classifyReportingWindow(A_SHIFT, 10, thirtyDaysLater)).toBe('closed');
  });

  it('미래 교대는 아직 열리지 않았다 — backlog 선점 경로를 막는다', () => {
    const oneDayEarlier = A_START - 24 * 60 * MINUTE;
    expect(classifyReportingWindow(A_SHIFT, 10, oneDayEarlier)).toBe('not_started');
  });

  it('유예 0분이면 종료 정각에 바로 닫힌다', () => {
    expect(classifyReportingWindow(A_SHIFT, 0, A_END)).toBe('closed');
    expect(classifyReportingWindow(A_SHIFT, 0, A_END - 1)).toBe('open');
  });

  it('음수 유예는 0 으로 취급한다 — 창을 좁혀 엉뚱하게 거부하지 않는다', () => {
    expect(classifyReportingWindow(A_SHIFT, -30, A_END - 1)).toBe('open');
    expect(classifyReportingWindow(A_SHIFT, -30, A_END)).toBe('closed');
  });

  describe('B교대는 자정을 넘는다', () => {
    // 2026-07-29 B교대: 현지 20:00 ~ 다음날 08:00
    const B_SHIFT = {
      start: Date.parse('2026-07-29T13:00:00.000Z'),
      end: Date.parse('2026-07-30T01:00:00.000Z'),
    };

    it('자정 직후(다음 날짜)도 같은 B교대로 열려 있다', () => {
      // 현지 2026-07-30 00:30 — 날짜는 바뀌었지만 귀속 교대는 7/29 B 다.
      const afterMidnight = Date.parse('2026-07-29T17:30:00.000Z');
      expect(classifyReportingWindow(B_SHIFT, 10, afterMidnight)).toBe('open');
    });

    it('다음날 아침 유예가 끝나면 닫힌다', () => {
      expect(classifyReportingWindow(B_SHIFT, 10, B_SHIFT.end + 10 * MINUTE)).toBe('closed');
    });
  });
});
