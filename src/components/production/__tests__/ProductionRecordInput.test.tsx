import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProductionRecordInput } from '../ProductionRecordInput';
import { Machine } from '@/types';

// Mock dependencies
jest.mock('antd', () => ({
  ...jest.requireActual('antd'),
  message: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const mockMachine: Machine = {
  id: 'machine-1',
  name: 'CNC-001',
  location: 'A동 1층',
  model_type: 'DMG MORI',
  default_tact_time: 120,
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const defaultProps = {
  visible: true,
  onClose: jest.fn(),
  machine: mockMachine,
  shift: 'A' as const,
  date: '2024-01-01',
  onSubmit: jest.fn(),
};

describe('ProductionRecordInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly with machine information', () => {
    render(<ProductionRecordInput {...defaultProps} />);
    
    expect(screen.getByText('생산 실적 입력')).toBeInTheDocument();
    expect(screen.getByText('CNC-001')).toBeInTheDocument();
    expect(screen.getByText('A동 1층')).toBeInTheDocument();
    expect(screen.getByText('A조')).toBeInTheDocument();
  });

  it('shows estimated output when provided', () => {
    render(<ProductionRecordInput {...defaultProps} estimatedOutput={100} />);
    
    expect(screen.getByText(/Tact Time 기반 추정 생산량: 100개/)).toBeInTheDocument();
    expect(screen.getByText('사용하기')).toBeInTheDocument();
  });

  it('validates input data correctly', async () => {
    const onSubmit = jest.fn();
    render(<ProductionRecordInput {...defaultProps} onSubmit={onSubmit} />);
    
    // Submit without filling required fields
    fireEvent.click(screen.getByText('입력 완료'));
    
    await waitFor(() => {
      expect(screen.getByText('생산 수량을 입력해주세요')).toBeInTheDocument();
      expect(screen.getByText('불량 수량을 입력해주세요')).toBeInTheDocument();
    });
    
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prevents defect quantity from exceeding output quantity', async () => {
    const onSubmit = jest.fn();
    render(<ProductionRecordInput {...defaultProps} onSubmit={onSubmit} />);
    
    // Fill in output quantity
    const outputInput = screen.getByPlaceholderText('생산된 총 수량을 입력하세요');
    fireEvent.change(outputInput, { target: { value: '100' } });
    
    // Fill in defect quantity higher than output
    const defectInput = screen.getByPlaceholderText('불량품 수량을 입력하세요');
    fireEvent.change(defectInput, { target: { value: '150' } });
    
    fireEvent.click(screen.getByText('입력 완료'));
    
    await waitFor(() => {
      expect(screen.getByText('불량 수량은 생산 수량보다 클 수 없습니다')).toBeInTheDocument();
    });
    
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits valid data correctly', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    render(<ProductionRecordInput {...defaultProps} onSubmit={onSubmit} />);
    
    // Fill in valid data
    const outputInput = screen.getByPlaceholderText('생산된 총 수량을 입력하세요');
    fireEvent.change(outputInput, { target: { value: '100' } });
    
    const defectInput = screen.getByPlaceholderText('불량품 수량을 입력하세요');
    fireEvent.change(defectInput, { target: { value: '5' } });
    
    fireEvent.click(screen.getByText('입력 완료'));
    
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        output_qty: 100,
        defect_qty: 5,
      });
    });
  });

  it('uses estimated output when button is clicked', () => {
    render(<ProductionRecordInput {...defaultProps} estimatedOutput={150} />);
    
    fireEvent.click(screen.getByText('사용하기'));
    
    const outputInput = screen.getByPlaceholderText('생산된 총 수량을 입력하세요');
    expect(outputInput).toHaveValue('150');
  });

  it('closes modal when cancel is clicked', () => {
    const onClose = jest.fn();
    render(<ProductionRecordInput {...defaultProps} onClose={onClose} />);
    
    fireEvent.click(screen.getByText('취소'));
    
    expect(onClose).toHaveBeenCalled();
  });
});