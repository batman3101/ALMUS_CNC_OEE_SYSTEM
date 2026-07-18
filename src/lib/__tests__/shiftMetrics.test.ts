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
});
