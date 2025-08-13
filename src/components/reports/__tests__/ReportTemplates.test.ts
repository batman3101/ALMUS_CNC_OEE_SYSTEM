import { ReportTemplates } from '../ReportTemplates';
import { OEEMetrics, Machine, ProductionRecord } from '@/types';

// Mock jsPDF and xlsx
jest.mock('jspdf', () => {
  return jest.fn().mockImplementation(() => ({
    internal: {
      pageSize: {
        getWidth: () => 210,
        getHeight: () => 297
      }
    },
    setFont: jest.fn(),
    setFontSize: jest.fn(),
    text: jest.fn(),
    line: jest.fn(),
    rect: jest.fn(),
    addPage: jest.fn(),
    save: jest.fn(),
    setDrawColor: jest.fn(),
    setLineWidth: jest.fn(),
    setFillColor: jest.fn(),
    addImage: jest.fn()
  }));
});

jest.mock('xlsx', () => ({
  utils: {
    book_new: jest.fn(() => ({})),
    aoa_to_sheet: jest.fn(() => ({})),
    book_append_sheet: jest.fn()
  },
  writeFile: jest.fn()
}));

describe('ReportTemplates', () => {
  const mockMachines: Machine[] = [
    {
      id: '1',
      name: 'CNC-001',
      location: 'A동 1층',
      model_type: 'HAAS VF-2',
      default_tact_time: 120,
      is_active: true,
      created_at: '2024-01-01T00:00:00Z'
    },
    {
      id: '2',
      name: 'CNC-002',
      location: 'A동 2층',
      model_type: 'MAZAK VTC-200',
      default_tact_time: 150,
      is_active: true,
      created_at: '2024-01-01T00:00:00Z'
    }
  ];

  const mockOEEData: OEEMetrics[] = [
    {
      availability: 0.85,
      performance: 0.90,
      quality: 0.95,
      oee: 0.726,
      actual_runtime: 420,
      planned_runtime: 480,
      ideal_runtime: 400,
      output_qty: 100,
      defect_qty: 5
    },
    {
      availability: 0.80,
      performance: 0.88,
      quality: 0.92,
      oee: 0.649,
      actual_runtime: 380,
      planned_runtime: 480,
      ideal_runtime: 360,
      output_qty: 90,
      defect_qty: 7
    }
  ];

  const mockProductionData: ProductionRecord[] = [
    {
      record_id: '1',
      machine_id: '1',
      date: '2024-01-01',
      shift: 'A',
      planned_runtime: 480,
      actual_runtime: 420,
      ideal_runtime: 400,
      output_qty: 100,
      defect_qty: 5,
      availability: 0.85,
      performance: 0.90,
      quality: 0.95,
      oee: 0.726,
      created_at: '2024-01-01T08:00:00Z'
    },
    {
      record_id: '2',
      machine_id: '2',
      date: '2024-01-01',
      shift: 'B',
      planned_runtime: 480,
      actual_runtime: 380,
      ideal_runtime: 360,
      output_qty: 90,
      defect_qty: 7,
      availability: 0.80,
      performance: 0.88,
      quality: 0.92,
      oee: 0.649,
      created_at: '2024-01-01T20:00:00Z'
    }
  ];

  const mockReportData = {
    machines: mockMachines,
    oeeData: mockOEEData,
    productionData: mockProductionData,
    reportType: 'summary' as const,
    dateRange: ['2024-01-01', '2024-01-07'] as [string, string],
    selectedMachines: ['1', '2'],
    includeCharts: true,
    includeOEE: true,
    includeProduction: true,
    includeDowntime: true,
    groupBy: 'machine' as const
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generatePDFReport', () => {
    it('should generate PDF report successfully', async () => {
      await expect(ReportTemplates.generatePDFReport(mockReportData)).resolves.not.toThrow();
    });

    it('should handle empty data gracefully', async () => {
      const emptyData = {
        ...mockReportData,
        machines: [],
        oeeData: [],
        productionData: []
      };

      await expect(ReportTemplates.generatePDFReport(emptyData)).resolves.not.toThrow();
    });
  });

  describe('generateExcelReport', () => {
    it('should generate Excel report successfully', async () => {
      await expect(ReportTemplates.generateExcelReport(mockReportData)).resolves.not.toThrow();
    });

    it('should create multiple sheets for different data types', async () => {
      const XLSX = require('xlsx');
      
      await ReportTemplates.generateExcelReport(mockReportData);

      // 요약, 설비목록, OEE데이터, 생산실적, 분석 시트가 생성되어야 함
      expect(XLSX.utils.book_append_sheet).toHaveBeenCalledTimes(5);
    });
  });

  describe('generateQuickReport', () => {
    it('should generate quick PDF report', async () => {
      await expect(
        ReportTemplates.generateQuickReport(mockMachines, mockOEEData, mockProductionData, 'pdf')
      ).resolves.not.toThrow();
    });

    it('should generate quick Excel report', async () => {
      await expect(
        ReportTemplates.generateQuickReport(mockMachines, mockOEEData, mockProductionData, 'excel')
      ).resolves.not.toThrow();
    });
  });

  describe('generatePreviewData', () => {
    it('should generate preview data correctly', () => {
      const preview = ReportTemplates.generatePreviewData(mockReportData);

      expect(preview).toHaveProperty('summary');
      expect(preview).toHaveProperty('chartCount');
      expect(preview).toHaveProperty('pageCount');

      expect(preview.summary.machineCount).toBe(2);
      expect(preview.summary.oeeDataCount).toBe(2);
      expect(preview.summary.productionDataCount).toBe(2);
      expect(preview.chartCount).toBeGreaterThan(0);
      expect(preview.pageCount).toBeGreaterThan(0);
    });

    it('should calculate chart count based on included options', () => {
      const dataWithoutCharts = {
        ...mockReportData,
        includeCharts: false
      };

      const preview = ReportTemplates.generatePreviewData(dataWithoutCharts);
      expect(preview.chartCount).toBe(0);
    });
  });

  describe('captureChartAsImage', () => {
    it('should capture canvas as image', async () => {
      const mockCanvas = {
        toDataURL: jest.fn().mockReturnValue('data:image/png;base64,mock-image-data')
      } as unknown as HTMLCanvasElement;

      const result = await ReportTemplates.captureChartAsImage(mockCanvas);
      
      expect(result).toBe('data:image/png;base64,mock-image-data');
      expect(mockCanvas.toDataURL).toHaveBeenCalledWith('image/png', 1.0);
    });
  });

  describe('generateTemplateReport', () => {
    it('should generate daily template report', async () => {
      await expect(
        ReportTemplates.generateTemplateReport('daily', mockReportData, 'pdf')
      ).resolves.not.toThrow();
    });

    it('should generate weekly template report', async () => {
      await expect(
        ReportTemplates.generateTemplateReport('weekly', mockReportData, 'excel')
      ).resolves.not.toThrow();
    });

    it('should generate monthly template report', async () => {
      await expect(
        ReportTemplates.generateTemplateReport('monthly', mockReportData, 'pdf')
      ).resolves.not.toThrow();
    });
  });
});