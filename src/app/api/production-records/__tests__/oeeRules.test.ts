import {
  calculateOeeMetrics,
  resolveActualRuntime,
  resolveHistoricalProductionParameters,
  synchronizeDowntime,
  validateDowntimeEntriesForWindow,
} from '../oeeRules';

describe('production record OEE rules', () => {
  describe('BUG-001 runtime defaults', () => {
    it('uses planned runtime when the operator request omits actual_runtime', () => {
      expect(resolveActualRuntime(undefined, 660)).toBe(660);
      expect(resolveActualRuntime(null, 660)).toBe(660);
      expect(resolveActualRuntime(0, 660)).toBe(0);
      expect(resolveActualRuntime(800, 660)).toBe(660);
    });

    it('produces non-zero OEE for normal production and zero at real zero boundaries', () => {
      const normal = calculateOeeMetrics({
        plannedRuntime: 660,
        actualRuntime: resolveActualRuntime(undefined, 660),
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

  describe('BUG-007 downtime shift boundaries', () => {
    const dayWindow = {
      start: Date.parse('2026-07-14T01:00:00.000Z'),
      end: Date.parse('2026-07-14T13:00:00.000Z'),
    };
    const nightWindow = {
      start: Date.parse('2026-07-14T13:00:00.000Z'),
      end: Date.parse('2026-07-15T01:00:00.000Z'),
    };

    it('rejects downtime that extends outside its declared business date and shift', () => {
      expect(validateDowntimeEntriesForWindow('주간조', [{
        start_time: '2026-07-14T00:59:00.000Z',
        end_time: '2026-07-14T02:00:00.000Z',
        reason: 'failure',
      }], dayWindow).error).toContain('교대 범위');

      expect(validateDowntimeEntriesForWindow('야간조', [{
        start_time: '2026-07-15T00:30:00.000Z',
        end_time: '2026-07-15T01:01:00.000Z',
        reason: 'failure',
      }], nightWindow).error).toContain('교대 범위');
    });

    it('accepts a night-shift interval that crosses midnight inside the window', () => {
      const result = validateDowntimeEntriesForWindow('야간조', [{
        start_time: '2026-07-14T16:30:00.000Z',
        end_time: '2026-07-14T18:30:00.000Z',
        reason: 'failure',
      }], nightWindow);

      expect(result.error).toBeUndefined();
      expect(result.totalMinutes).toBe(120);
    });
  });
});
