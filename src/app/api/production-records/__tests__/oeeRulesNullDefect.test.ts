import { calculateOeeMetrics } from '../oeeRules';

describe('calculateOeeMetrics — defect NULL(미검사)', () => {
  const base = { plannedRuntime: 600, actualRuntime: 540, outputQty: 100, minutesPerUnit: 5 };

  it('defect 가 숫자면 quality·oee 를 계산한다 (기존 동작 유지)', () => {
    const m = calculateOeeMetrics({ ...base, defectQty: 10 });
    expect(m.quality).toBeCloseTo(0.9, 5);
    expect(m.oee).not.toBeNull();
  });

  it('defect 가 NULL 이면 quality·oee 는 NULL, availability·performance 는 유지', () => {
    const m = calculateOeeMetrics({ ...base, defectQty: null });
    expect(m.quality).toBeNull();
    expect(m.oee).toBeNull();
    // 가동×성능은 검사와 무관하므로 여전히 계산된다.
    expect(m.availability).toBeGreaterThan(0);
    expect(m.performance).toBeGreaterThan(0);
  });
});
