jest.mock('jspdf', () => jest.fn());
jest.mock('jspdf-autotable', () => jest.fn());
jest.mock('xlsx', () => ({}));
jest.mock('html2canvas', () => jest.fn());
jest.mock('@/lib/fonts', () => ({ addKoreanText: jest.fn() }));

import {
  ReportTemplates,
  assertReportExportReady,
  buildDetailedMachineRows,
  buildProductionDetailRows,
  calculateWeightedReportMetrics,
  getProductionDateRange,
  isRangeCovered,
} from '../ReportTemplates';
import { Machine, ProductionRecord } from '@/types';
import { OEEMetrics } from '@/types/reports';

const oeeRows: OEEMetrics[] = [
  {
    machine_id: 'm1',
    planned_runtime: 100,
    actual_runtime: 50,
    ideal_runtime: 40,
    output_qty: 100,
    defect_qty: 0,
    availability: 0.5,
    performance: 0.8,
    quality: 1,
    oee: 0.4,
  },
  {
    machine_id: 'm2',
    planned_runtime: 900,
    actual_runtime: 900,
    ideal_runtime: 450,
    output_qty: 1,
    defect_qty: 1,
    availability: 1,
    performance: 0.5,
    quality: 0,
    oee: 0,
  },
];

const productionRows = [
  { machine_id: 'm1', date: '2026-07-14', shift: 'A', output_qty: 100, defect_qty: 0 },
  { machine_id: 'm2', date: '2026-07-15', shift: 'B', output_qty: 1, defect_qty: 1 },
] as ProductionRecord[];

describe('report correctness rules', () => {
  it('uses runtime/output weighted OEE metrics', () => {
    const result = calculateWeightedReportMetrics(oeeRows);

    expect(result.availability).toBeCloseTo(0.95, 8);
    expect(result.performance).toBeCloseTo(490 / 950, 8);
    expect(result.quality).toBeCloseTo(100 / 101, 8);
    expect(result.oee).toBeCloseTo(0.95 * (490 / 950) * (100 / 101), 8);
  });

  it('does not silently cut detailed machine or production rows to ten', () => {
    const machines = Array.from({ length: 12 }, (_, index) => ({
      id: `m${index}`,
      name: `M${index}`,
      is_active: true,
    })) as Machine[];
    const production = Array.from({ length: 12 }, (_, index) => ({
      machine_id: `m${index}`,
      date: '2026-07-15',
      shift: 'A',
      output_qty: 1,
      defect_qty: 0,
      oee: 1,
    })) as ProductionRecord[];

    expect(buildDetailedMachineRows(machines, oeeRows)).toHaveLength(12);
    expect(buildProductionDetailRows(production)).toHaveLength(12);
  });

  it('supports honest date and shift grouping', () => {
    const base = {
      machines: [] as Machine[],
      oeeData: oeeRows,
      productionData: productionRows,
      reportType: 'summary' as const,
      dateRange: ['2026-07-14', '2026-07-15'] as [string, string],
      selectedMachines: [],
      includeCharts: false,
      includeOEE: true,
      includeProduction: true,
      groupBy: 'date' as const,
    };

    const byDate = ReportTemplates.generateAnalysisData(base);
    expect(byDate).toEqual(expect.arrayContaining([
      expect.arrayContaining(['2026-07-14']),
      expect.arrayContaining(['2026-07-15']),
    ]));

    const byShift = ReportTemplates.generateAnalysisData({ ...base, groupBy: 'shift' });
    expect(byShift).toEqual(expect.arrayContaining([
      expect.arrayContaining(['A']),
      expect.arrayContaining(['B']),
    ]));
  });

  it('blocks exports outside the authoritative loaded range or from truncated data', () => {
    expect(isRangeCovered(['2026-07-01', '2026-07-31'], ['2026-07-05', '2026-07-10']))
      .toBe(true);
    expect(isRangeCovered(['2026-07-01', '2026-07-31'], ['2026-06-30', '2026-07-10']))
      .toBe(false);

    expect(() => assertReportExportReady({
      loadedRange: ['2026-07-01', '2026-07-31'],
      requestedRange: ['2026-06-30', '2026-07-10'],
      isComplete: true,
    })).toThrow(/조회된 기간/);

    expect(() => assertReportExportReady({
      loadedRange: ['2026-07-01', '2026-07-31'],
      requestedRange: ['2026-07-05', '2026-07-10'],
      isComplete: false,
    })).toThrow(/전체 데이터/);
  });

  it('labels quick exports with the actual filtered data range', () => {
    expect(getProductionDateRange(productionRows)).toEqual(['2026-07-14', '2026-07-15']);
    expect(() => getProductionDateRange([])).toThrow(/내보낼 생산실적/);
  });

  it('explicitly blocks oversized detailed PDFs instead of freezing the browser', async () => {
    await expect(ReportTemplates.generatePDFReport({
      machines: [],
      oeeData: [],
      productionData: Array.from({ length: 5001 }, (_, index) => ({
        record_id: `r${index}`,
        machine_id: 'm1',
        date: '2026-07-15',
        shift: 'A',
        output_qty: 1,
        defect_qty: 0,
      })) as ProductionRecord[],
      reportType: 'detailed',
      dateRange: ['2026-07-15', '2026-07-15'],
      selectedMachines: [],
      includeCharts: false,
      includeOEE: true,
      includeProduction: true,
      groupBy: 'machine',
    })).rejects.toThrow(/최대 5,000건/);
  });
});
