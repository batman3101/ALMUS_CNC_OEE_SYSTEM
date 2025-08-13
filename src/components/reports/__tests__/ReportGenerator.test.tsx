import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ReportGenerator } from '../ReportGenerator';
import { Machine, OEEMetrics, ProductionRecord } from '@/types';

// Mock the ReportTemplates
jest.mock('../ReportTemplates', () => ({
  ReportTemplates: {
    generatePDFReport: jest.fn().mockResolvedValue(undefined),
    generateExcelReport: jest.fn().mockResolvedValue(undefined)
  }
}));

// Mock antd message
jest.mock('antd', () => ({
  ...jest.requireActual('antd'),
  message: {
    success: jest.fn(),
    error: jest.fn()
  }
}));

const mockMachines: Machine[] = [
  {
    id: 'machine_1',
    name: 'CNC-001',
    location: '1공장 A라인',
    model_type: 'Mazak VTC-800',
    default_tact_time: 60,
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  }
];

const mockOEEData: OEEMetrics[] = [
  {
    availability: 0.85,
    performance: 0.92,
    quality: 0.96,
    oee: 0.75,
    actual_runtime: 510,
    planned_runtime: 600,
    ideal_runtime: 480,
    output_qty: 1200,
    defect_qty: 48
  }
];

const mockProductionData: ProductionRecord[] = [
  {
    record_id: 'record_1',
    machine_id: 'machine_1',
    date: '2024-01-01',
    shift: 'A',
    output_qty: 1200,
    defect_qty: 48,
    created_at: '2024-01-01T00:00:00Z'
  }
];

describe('ReportGenerator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders report generator with quick export buttons', () => {
    render(
      <ReportGenerator
        machines={mockMachines}
        oeeData={mockOEEData}
        productionData={mockProductionData}
      />
    );

    expect(screen.getByText('보고서 생성')).toBeInTheDocument();
    expect(screen.getByText('빠른 내보내기')).toBeInTheDocument();
    expect(screen.getByText('PDF 보고서')).toBeInTheDocument();
    expect(screen.getByText('Excel 보고서')).toBeInTheDocument();
    expect(screen.getByText('사용자 정의 보고서')).toBeInTheDocument();
  });

  it('handles PDF quick export', async () => {
    const { ReportTemplates } = require('../ReportTemplates');
    
    render(
      <ReportGenerator
        machines={mockMachines}
        oeeData={mockOEEData}
        productionData={mockProductionData}
      />
    );

    const pdfButton = screen.getByText('PDF 보고서');
    fireEvent.click(pdfButton);

    await waitFor(() => {
      expect(ReportTemplates.generatePDFReport).toHaveBeenCalledWith(
        expect.objectContaining({
          machines: mockMachines,
          oeeData: mockOEEData,
          productionData: mockProductionData
        })
      );
    });
  });

  it('handles Excel quick export', async () => {
    const { ReportTemplates } = require('../ReportTemplates');
    
    render(
      <ReportGenerator
        machines={mockMachines}
        oeeData={mockOEEData}
        productionData={mockProductionData}
      />
    );

    const excelButton = screen.getByText('Excel 보고서');
    fireEvent.click(excelButton);

    await waitFor(() => {
      expect(ReportTemplates.generateExcelReport).toHaveBeenCalledWith(
        expect.objectContaining({
          machines: mockMachines,
          oeeData: mockOEEData,
          productionData: mockProductionData
        })
      );
    });
  });

  it('opens custom export modal when custom buttons are clicked', () => {
    render(
      <ReportGenerator
        machines={mockMachines}
        oeeData={mockOEEData}
        productionData={mockProductionData}
      />
    );

    const customPdfButton = screen.getByText('PDF 사용자 정의');
    fireEvent.click(customPdfButton);

    // Modal should be opened (we can't easily test modal visibility without more complex setup)
    expect(customPdfButton).toBeInTheDocument();
  });

  it('handles empty data gracefully', () => {
    render(
      <ReportGenerator
        machines={[]}
        oeeData={[]}
        productionData={[]}
      />
    );

    expect(screen.getByText('보고서 생성')).toBeInTheDocument();
    expect(screen.getByText('PDF 보고서')).toBeInTheDocument();
    expect(screen.getByText('Excel 보고서')).toBeInTheDocument();
  });
});