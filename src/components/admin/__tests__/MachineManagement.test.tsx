import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { message } from 'antd';
import MachineManagement from '../MachineManagement';
import { useTranslation } from '@/hooks/useTranslation';
import { useAdminOperations } from '@/hooks/useAdminOperations';

// Mock the hooks
jest.mock('@/hooks/useTranslation');
jest.mock('@/hooks/useAdminOperations');
jest.mock('antd', () => ({
  ...jest.requireActual('antd'),
  message: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const mockUseTranslation = useTranslation as jest.MockedFunction<typeof useTranslation>;
const mockUseAdminOperations = useAdminOperations as jest.MockedFunction<typeof useAdminOperations>;

const mockMachines = [
  {
    id: '1',
    name: 'CNC-001',
    location: 'Factory A',
    model_type: 'Haas VF-2',
    default_tact_time: 60,
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  },
  {
    id: '2',
    name: 'CNC-002',
    location: 'Factory B',
    model_type: 'Mazak VTC-200',
    default_tact_time: 45,
    is_active: false,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z'
  }
];

describe('MachineManagement', () => {
  const mockFetchMachines = jest.fn();
  const mockDeleteMachine = jest.fn();
  const mockUpdateMachine = jest.fn();

  beforeEach(() => {
    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
      language: 'ko',
      changeLanguage: jest.fn()
    });

    mockUseAdminOperations.mockReturnValue({
      loading: false,
      fetchMachines: mockFetchMachines,
      deleteMachine: mockDeleteMachine,
      updateMachine: mockUpdateMachine,
      createUser: jest.fn(),
      updateUser: jest.fn(),
      deleteUser: jest.fn(),
      fetchUsers: jest.fn(),
      createMachine: jest.fn()
    });

    mockFetchMachines.mockResolvedValue(mockMachines);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders machine management interface', async () => {
    render(<MachineManagement />);

    await waitFor(() => {
      expect(screen.getByText('admin.machineManagement.title')).toBeInTheDocument();
      expect(screen.getByText('admin.machineManagement.addMachine')).toBeInTheDocument();
    });
  });

  it('displays machines in table', async () => {
    render(<MachineManagement />);

    await waitFor(() => {
      expect(screen.getByText('CNC-001')).toBeInTheDocument();
      expect(screen.getByText('CNC-002')).toBeInTheDocument();
      expect(screen.getByText('Factory A')).toBeInTheDocument();
      expect(screen.getByText('Factory B')).toBeInTheDocument();
    });
  });

  it('handles machine deletion', async () => {
    mockDeleteMachine.mockResolvedValue({ success: true });
    
    render(<MachineManagement />);

    await waitFor(() => {
      expect(screen.getByText('CNC-001')).toBeInTheDocument();
    });

    // Find and click delete button for first machine
    const deleteButtons = screen.getAllByText('common.app.delete');
    fireEvent.click(deleteButtons[0]);

    // Confirm deletion
    const confirmButton = screen.getByText('common.app.confirm');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockDeleteMachine).toHaveBeenCalledWith('1');
      expect(message.success).toHaveBeenCalledWith('admin.machineManagement.deleteSuccess');
    });
  });

  it('handles machine status toggle', async () => {
    mockUpdateMachine.mockResolvedValue({ success: true });
    
    render(<MachineManagement />);

    await waitFor(() => {
      expect(screen.getByText('CNC-001')).toBeInTheDocument();
    });

    // Find and click status switch for first machine
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]);

    await waitFor(() => {
      expect(mockUpdateMachine).toHaveBeenCalledWith('1', { is_active: false });
      expect(message.success).toHaveBeenCalledWith('admin.machineManagement.saveSuccess');
    });
  });

  it('filters machines by search text', async () => {
    render(<MachineManagement />);

    await waitFor(() => {
      expect(screen.getByText('CNC-001')).toBeInTheDocument();
      expect(screen.getByText('CNC-002')).toBeInTheDocument();
    });

    // Search for specific machine
    const searchInput = screen.getByPlaceholderText('admin.common.search');
    fireEvent.change(searchInput, { target: { value: 'CNC-001' } });

    await waitFor(() => {
      expect(screen.getByText('CNC-001')).toBeInTheDocument();
      expect(screen.queryByText('CNC-002')).not.toBeInTheDocument();
    });
  });
});