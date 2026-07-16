import {
  calculateOeeMetrics,
  resolveActualRuntime,
  resolveHistoricalProductionParameters,
  synchronizeDowntime,
} from '../oeeRules';

describe('production record OEE rules', () => {
  describe('BUG-001 runtime defaults', () => {
    it('keeps omitted actual_runtime unreported instead of assuming full availability', () => {
      expect(resolveActualRuntime(undefined, 660)).toBeNull();
      expect(resolveActualRuntime(null, 660)).toBeNull();
      expect(resolveActualRuntime(0, 660)).toBe(0);
      expect(resolveActualRuntime(800, 660)).toBe(660);
    });

    it('produces non-zero OEE only after runtime has been explicitly reported', () => {
      const normal = calculateOeeMetrics({
        plannedRuntime: 660,
        actualRuntime: resolveActualRuntime(600, 660) as number,
        outputQty: 100,
        defectQty: 0,
        minutesPerUnit: 2,
      });
      expect(normal.oee).toBeGreaterThan(0);
      expect(calculateOeeMetrics({
        plannedRuntime: 660,
        actualRuntime: 0,
        outputQty: 100,
        defectQty: 0,
        minutesPerUnit: 2,
      }).oee).toBe(0);
      expect(calculateOeeMetrics({
        plannedRuntime: 660,
        actualRuntime: 660,
        outputQty: 0,
        defectQty: 0,
        minutesPerUnit: 2,
      }).oee).toBe(0);
    });
  });

  describe('BUG-003 historical process snapshots', () => {
    it('keeps the saved tact/cavity after the current process changes', () => {
      const result = resolveHistoricalProductionParameters({
        output_qty: 100,
        ideal_runtime: 100,
        tact_time_seconds: 120,
        cavity_count: 2,
      }, 300, 1);

      expect(result).toEqual({ tactSeconds: 120, cavity: 2, minutesPerUnit: 1 });
    });

    it('falls back to stored ideal runtime for a legacy row without snapshots', () => {
      const result = resolveHistoricalProductionParameters({
        output_qty: 100,
        ideal_runtime: 50,
        tact_time_seconds: null,
        cavity_count: null,
      }, 300, 1);

      expect(result.minutesPerUnit).toBe(0.5);
      expect(result.tactSeconds).toBe(0);
      expect(result.cavity).toBe(0);
    });
  });

  describe('BUG-015 runtime/downtime invariant', () => {
    it('synchronizes downtime for actual-only, planned-only, and combined edits', () => {
      expect(synchronizeDowntime(660, 600, true, null)).toBe(60);
      expect(synchronizeDowntime(600, 550, true, 10)).toBe(50);
      expect(synchronizeDowntime(500, 450, true, 20)).toBe(50);
    });

    it('preserves NULL downtime when only quantities are edited', () => {
      expect(synchronizeDowntime(660, 600, false, null)).toBeNull();
    });
  });
});
