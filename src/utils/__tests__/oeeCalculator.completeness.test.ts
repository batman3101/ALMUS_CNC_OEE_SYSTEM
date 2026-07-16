import { OEECalculator } from '../oeeCalculator';

describe('OEECalculator completeness', () => {
  it('does not calculate OEE from an unreported runtime', () => {
    expect(OEECalculator.calculateOEEFromRecord({
      record_id: 'record-1',
      machine_id: 'machine-1',
      date: '2026-07-15',
      shift: 'A',
      planned_runtime: 660,
      actual_runtime: null,
      ideal_runtime: 120,
      output_qty: 60,
      defect_qty: 0,
      created_at: '2026-07-15T00:00:00.000Z',
    })).toBeNull();
  });
});
