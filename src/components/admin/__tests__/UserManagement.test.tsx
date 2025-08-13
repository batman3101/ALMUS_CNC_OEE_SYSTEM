import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { message } from 'antd';
import UserManagement from '../UserManagement';
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

const mockUsers = [
  {
    id: '1',
    email: 'admin@example.com',
    name: 'Admin User',
    role: 'admin' as const,
    assigned_machines: null,
    created_at: '2024-01-01T00:00:00Z'
  },
  {
    id: '2',
    email: 'operator@example.com',
    name: 'Operator User',
    role: 'operator' as const,
    assigned_machines: ['machine-1', 'machine-2'],
    created_at: '2024-01-02T00:00:00Z'
  }
];

describe('UserManagement', () => {
  const mockFetchUsers = jest.fn();
  const mockDeleteUser = jest.fn();

  beforeEach(() => {
    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
      language: 'ko',
      changeLanguage: jest.fn()
    });

    mockUseAdminOperations.mockReturnValue({
      loading: false,
      fetchUsers: mockFetchUsers,
      deleteUser: mockDeleteUser,
      createUser: jest.fn(),
      updateUser: jest.fn(),
      fetchMachines: jest.fn(),
      createMachine: jest.fn(),
      updateMachine: jest.fn(),
      deleteMachine: jest.fn()
    });

    mockFetchUsers.mockResolvedValue(mockUsers);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders user management interface', async () => {
    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByText('admin.userManagement.title')).toBeInTheDocument();
      expect(screen.getByText('admin.userManagement.addUser')).toBeInTheDocument();
    });
  });

  it('displays users in table', async () => {
    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
      expect(screen.getByText('Operator User')).toBeInTheDocument();
      expect(screen.getByText('admin@example.com')).toBeInTheDocument();
      expect(screen.getByText('operator@example.com')).toBeInTheDocument();
    });
  });

  it('handles user deletion', async () => {
    mockDeleteUser.mockResolvedValue({ success: true });
    
    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
    });

    // Find and click delete button for first user
    const deleteButtons = screen.getAllByText('common.app.delete');
    fireEvent.click(deleteButtons[0]);

    // Confirm deletion
    const confirmButton = screen.getByText('common.app.confirm');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockDeleteUser).toHaveBeenCalledWith('1');
      expect(message.success).toHaveBeenCalledWith('admin.userManagement.deleteSuccess');
    });
  });

  it('filters users by search text', async () => {
    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
      expect(screen.getByText('Operator User')).toBeInTheDocument();
    });

    // Search for specific user
    const searchInput = screen.getByPlaceholderText('admin.common.search');
    fireEvent.change(searchInput, { target: { value: 'Admin' } });

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
      expect(screen.queryByText('Operator User')).not.toBeInTheDocument();
    });
  });

  it('displays role tags with correct colors', async () => {
    render(<UserManagement />);

    await waitFor(() => {
      const adminTag = screen.getByText('roles.admin');
      const operatorTag = screen.getByText('roles.operator');
      
      expect(adminTag).toBeInTheDocument();
      expect(operatorTag).toBeInTheDocument();
    });
  });

  it('shows assigned machines count for operators', async () => {
    render(<UserManagement />);

    await waitFor(() => {
      expect(screen.getByText('2개 설비')).toBeInTheDocument();
    });
  });
});