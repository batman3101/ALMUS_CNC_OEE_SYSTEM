jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockRequireUser = jest.fn();
const mockRpc = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  apiAuthErrorResponse: () => null,
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { GET } from '../route';

const aggregateRow = {
  records_count: 3,
  reported_records: 1,
  unreported_records: 1,
  invalid_records: 1,
  total_planned_runtime: 600,
  total_actual_runtime: 500,
  total_ideal_runtime: 400,
  total_output: 100,
  total_defect_qty: 2,
  total_good_qty: 98,
  reported_output: 80,
  reported_defect_qty: 1,
};

describe('GET /api/productivity-analysis reporting quality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'engineer-1', role: 'engineer' });
    mockRpc.mockResolvedValue({
      data: {
        reporting_coverage: {
          total_records: 3,
          reported_records: 1,
          unreported_records: 1,
          invalid_records: 1,
        },
        totals: {
          ...aggregateRow,
          total_output_qty: 100,
          total_defect_qty: 2,
          reported_output_qty: 80,
          reported_defect_qty: 1,
          unique_machines: 1,
          shifts_analyzed: 1,
        },
        machines: [{
          ...aggregateRow,
          machine_id: 'machine-1',
          machine_name: 'M1',
          equipment_type: 'CNC',
          best_shift: 'A',
          worst_shift: 'A',
          first_rn: 1,
        }],
        shifts: [{ ...aggregateRow, shift: 'A', machines_count: 1, first_rn: 1 }],
        daily: [{ ...aggregateRow, date: '2026-07-15', active_machines: 1 }],
      },
      error: null,
    });
  });

  it('surfaces incomplete and invalid rows without silently reducing total coverage', async () => {
    const response = await GET({
      url: 'http://localhost/api/productivity-analysis?start_date=2026-07-15&end_date=2026-07-15',
    } as never);
    const body = await response.json() as {
      summary: { reporting_coverage: Record<string, number | boolean> };
      machine_analysis: Array<{ reporting_coverage: Record<string, number> }>;
      shift_analysis: Array<{ reporting_coverage: Record<string, number> }>;
      trends: { daily: Array<{ reporting_coverage: Record<string, number> }> };
    };

    expect(body.summary.reporting_coverage).toEqual(expect.objectContaining({
      total_records: 3,
      reported_records: 1,
      unreported_records: 1,
      invalid_records: 1,
      excluded_records: 2,
      incomplete: true,
    }));
    expect(body.machine_analysis[0].reporting_coverage.invalid_records).toBe(1);
    expect(body.shift_analysis[0].reporting_coverage.invalid_records).toBe(1);
    expect(body.trends.daily[0].reporting_coverage.invalid_records).toBe(1);
  });

  it('keeps invalid-row quantities out of administrator production and defect totals', async () => {
    const validTotals = {
      records_count: 2,
      reported_records: 1,
      unreported_records: 0,
      invalid_records: 1,
      total_planned_runtime: 100,
      total_actual_runtime: 80,
      total_ideal_runtime: 60,
      total_output: 10,
      total_defect_qty: 1,
      total_good_qty: 9,
      reported_output: 10,
      reported_defect_qty: 1,
      invalid_output_qty: -50,
      invalid_defect_qty: 100,
    };
    mockRpc.mockResolvedValueOnce({
      data: {
        reporting_coverage: {
          total_records: 2,
          reported_records: 1,
          unreported_records: 0,
          invalid_records: 1,
        },
        totals: {
          ...validTotals,
          total_output_qty: 10,
          total_defect_qty: 1,
          reported_output_qty: 10,
          reported_defect_qty: 1,
          unique_machines: 1,
          shifts_analyzed: 1,
        },
        machines: [{
          ...validTotals,
          machine_id: 'machine-valid',
          machine_name: 'M1',
          equipment_type: 'CNC',
          best_shift: 'A',
          worst_shift: 'A',
        }],
        shifts: [{ ...validTotals, shift: 'A', machines_count: 1 }],
        daily: [{ ...validTotals, date: '2026-07-15', active_machines: 1 }],
      },
      error: null,
    });

    const response = await GET({
      url: 'http://localhost/api/productivity-analysis?start_date=2026-07-15&end_date=2026-07-15',
    } as never);
    const body = await response.json() as {
      summary: {
        reporting_coverage: { total_records: number; invalid_records: number };
        overall_performance: {
          total_output_qty: number;
          total_good_qty: number;
          total_defect_qty: number;
          overall_defect_rate: number;
        };
      };
      machine_analysis: Array<{ total_output: number; total_good_qty: number; total_defect_qty: number; defect_rate: number }>;
      shift_analysis: Array<{ total_output: number; total_good_qty: number; defect_rate: number }>;
      trends: { daily: Array<{ total_output: number; total_good_qty: number; defect_rate: number }> };
    };

    expect(body.summary.reporting_coverage).toEqual(expect.objectContaining({
      total_records: 2,
      invalid_records: 1,
    }));
    expect(body.summary.overall_performance).toEqual(expect.objectContaining({
      total_output_qty: 10,
      total_good_qty: 9,
      total_defect_qty: 1,
      overall_defect_rate: 10,
    }));
    expect(body.machine_analysis[0]).toEqual(expect.objectContaining({
      total_output: 10,
      total_good_qty: 9,
      total_defect_qty: 1,
      defect_rate: 10,
    }));
    expect(body.shift_analysis[0]).toEqual(expect.objectContaining({
      total_output: 10,
      total_good_qty: 9,
      defect_rate: 10,
    }));
    expect(body.trends.daily[0]).toEqual(expect.objectContaining({
      total_output: 10,
      total_good_qty: 9,
      defect_rate: 10,
    }));
  });

  it('keeps production totals but returns unavailable OEE and no ranking when nothing is reported', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        reporting_coverage: {
          total_records: 1,
          reported_records: 0,
          unreported_records: 1,
          invalid_records: 0,
        },
        totals: {
          records_count: 1,
          reported_records: 0,
          unreported_records: 1,
          invalid_records: 0,
          total_planned_runtime: 0,
          total_actual_runtime: 0,
          total_ideal_runtime: 0,
          total_output_qty: 42,
          total_defect_qty: 2,
          reported_output_qty: 0,
          reported_defect_qty: 0,
          unique_machines: 1,
          shifts_analyzed: 1,
        },
        machines: [{
          ...aggregateRow,
          records_count: 1,
          reported_records: 0,
          unreported_records: 1,
          invalid_records: 0,
          total_planned_runtime: 0,
          total_actual_runtime: 0,
          total_ideal_runtime: 0,
          total_output: 42,
          total_defect_qty: 2,
          total_good_qty: 40,
          reported_output: 0,
          reported_defect_qty: 0,
          machine_id: 'machine-unreported',
          machine_name: 'M2',
          equipment_type: 'CNC',
          best_shift: null,
          worst_shift: null,
          first_rn: 1,
        }],
        shifts: [],
        daily: [],
      },
      error: null,
    });

    const response = await GET({
      url: 'http://localhost/api/productivity-analysis?start_date=2026-07-15&end_date=2026-07-15',
    } as never);
    const body = await response.json() as {
      summary: { overall_performance: { avg_oee: number | null; total_output_qty: number } };
      machine_analysis: Array<{ avg_oee: number | null; total_output: number; oee_available: boolean }>;
      performance_ranking: { top_performers: unknown[]; bottom_performers: unknown[] };
    };

    expect(body.summary.overall_performance.avg_oee).toBeNull();
    expect(body.summary.overall_performance.total_output_qty).toBe(42);
    expect(body.machine_analysis[0]).toEqual(expect.objectContaining({
      avg_oee: null,
      total_output: 42,
      oee_available: false,
    }));
    expect(body.performance_ranking.top_performers).toEqual([]);
    expect(body.performance_ranking.bottom_performers).toEqual([]);
  });

  it('returns zero OEE for a confirmed working shift with zero production', async () => {
    const confirmedZero = {
      records_count: 1,
      reported_records: 1,
      unreported_records: 0,
      invalid_records: 0,
      total_planned_runtime: 660,
      total_actual_runtime: 0,
      total_ideal_runtime: 0,
      total_output: 0,
      total_defect_qty: 0,
      total_good_qty: 0,
      reported_output: 0,
      reported_defect_qty: 0,
    };
    mockRpc.mockResolvedValueOnce({
      data: {
        reporting_coverage: {
          total_records: 1,
          reported_records: 1,
          unreported_records: 0,
          invalid_records: 0,
        },
        totals: {
          ...confirmedZero,
          total_output_qty: 0,
          total_defect_qty: 0,
          reported_output_qty: 0,
          reported_defect_qty: 0,
          unique_machines: 1,
          shifts_analyzed: 1,
        },
        machines: [{
          ...confirmedZero,
          machine_id: 'machine-zero',
          machine_name: 'M0',
          equipment_type: 'CNC',
          best_shift: 'A',
          worst_shift: 'A',
        }],
        shifts: [{ ...confirmedZero, shift: 'A', machines_count: 1 }],
        daily: [{ ...confirmedZero, date: '2026-07-15', active_machines: 1 }],
      },
      error: null,
    });

    const response = await GET({
      url: 'http://localhost/api/productivity-analysis?start_date=2026-07-15&end_date=2026-07-15',
    } as never);
    const body = await response.json() as {
      summary: { overall_performance: { avg_oee: number | null; total_output_qty: number } };
      machine_analysis: Array<{ avg_oee: number | null; oee_available: boolean; total_output: number }>;
      shift_analysis: Array<{ avg_oee: number | null; oee_available: boolean }>;
      trends: { daily: Array<{ avg_oee: number | null; oee_available: boolean }> };
    };

    expect(body.summary.overall_performance).toEqual(expect.objectContaining({
      avg_oee: 0,
      total_output_qty: 0,
    }));
    expect(body.machine_analysis[0]).toEqual(expect.objectContaining({
      avg_oee: 0,
      oee_available: true,
      total_output: 0,
    }));
    expect(body.shift_analysis[0]).toEqual(expect.objectContaining({ avg_oee: 0, oee_available: true }));
    expect(body.trends.daily[0]).toEqual(expect.objectContaining({ avg_oee: 0, oee_available: true }));
  });
});
