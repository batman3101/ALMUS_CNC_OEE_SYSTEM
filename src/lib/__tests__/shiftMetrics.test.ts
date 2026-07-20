import { computeShiftSnapshot } from '../shiftMetrics';

describe('computeShiftSnapshot', () => {
  it('downtime 이 null 이면 런타임 계열을 null 로 남긴다 (미보고 ≠ 완전가동)', () => {
    const s = computeShiftSnapshot({
      operatingMinutes: 720, breakMinutes: 110, downtimeMinutes: null,
      outputQty: 100, defectQty: null, tactSeconds: 300,
    });
    expect(s.actualRuntime).toBeNull();
    expect(s.availability).toBeNull();
    expect(s.oee).toBeNull();
  });

  it('downtime 이 값이고 defect 가 null 이면 avail·perf 는 계산, quality·oee 는 null', () => {
    const s = computeShiftSnapshot({
      operatingMinutes: 720, breakMinutes: 110, downtimeMinutes: 60,
      outputQty: 100, defectQty: null, tactSeconds: 300,
    });
    // planned = 720-110 = 610, actual = 610-60 = 550
    expect(s.plannedRuntime).toBe(610);
    expect(s.actualRuntime).toBe(550);
    expect(s.availability).toBeGreaterThan(0);
    expect(s.performance).toBeGreaterThan(0);
    expect(s.quality).toBeNull();
    expect(s.oee).toBeNull();
  });

  // Codex 감사 #2: tact 미확인을 120초 등 임의값으로 채워 성능을 날조 저장하면 안 된다(NULL≠0).
  it('tact 가 null 이면 ideal·perf·oee 는 null, avail 은 계산한다', () => {
    const s = computeShiftSnapshot({
      operatingMinutes: 720, breakMinutes: 110, downtimeMinutes: 60,
      outputQty: 100, defectQty: 5, tactSeconds: null,
    });
    expect(s.idealRuntime).toBeNull();
    expect(s.performance).toBeNull();
    expect(s.oee).toBeNull();
    expect(s.availability).toBeCloseTo(550 / 610, 5);   // tact 와 무관하므로 계산
    expect(s.quality).toBeCloseTo(0.95, 5);             // 검사 결과만으로 계산
  });

  it('tact null + downtime null 이면 성능·런타임 계열 모두 null', () => {
    const s = computeShiftSnapshot({
      operatingMinutes: 720, breakMinutes: 110, downtimeMinutes: null,
      outputQty: 100, defectQty: null, tactSeconds: null,
    });
    expect(s.actualRuntime).toBeNull();
    expect(s.idealRuntime).toBeNull();
    expect(s.availability).toBeNull();
    expect(s.performance).toBeNull();
    expect(s.quality).toBeNull();
    expect(s.oee).toBeNull();
  });
});
