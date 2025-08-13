import React from 'react';
import { render } from '@testing-library/react';
import { notification } from 'antd';
import { 
  showToast, 
  toastSuccess, 
  toastError, 
  toastWarning, 
  toastInfo,
  clearAllToasts 
} from '../ToastNotification';

// Mock antd notification
jest.mock('antd', () => ({
  notification: {
    config: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
    destroy: jest.fn(),
  },
}));

describe('ToastNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('showToast', () => {
    it('shows success toast', () => {
      showToast({
        type: 'success',
        title: 'Success Title',
        message: 'Success message'
      });

      expect(notification.success).toHaveBeenCalledWith({
        message: 'Success Title',
        description: 'Success message',
        icon: expect.any(Object),
        duration: 4.5
      });
    });

    it('shows error toast', () => {
      showToast({
        type: 'error',
        title: 'Error Title',
        message: 'Error message'
      });

      expect(notification.error).toHaveBeenCalledWith({
        message: 'Error Title',
        description: 'Error message',
        icon: expect.any(Object),
        duration: 4.5
      });
    });

    it('shows warning toast', () => {
      showToast({
        type: 'warning',
        title: 'Warning Title',
        message: 'Warning message'
      });

      expect(notification.warning).toHaveBeenCalledWith({
        message: 'Warning Title',
        description: 'Warning message',
        icon: expect.any(Object),
        duration: 4.5
      });
    });

    it('shows info toast', () => {
      showToast({
        type: 'info',
        title: 'Info Title',
        message: 'Info message'
      });

      expect(notification.info).toHaveBeenCalledWith({
        message: 'Info Title',
        description: 'Info message',
        icon: expect.any(Object),
        duration: 4.5
      });
    });

    it('uses custom duration', () => {
      showToast({
        type: 'success',
        title: 'Title',
        message: 'Message',
        duration: 3000
      });

      expect(notification.success).toHaveBeenCalledWith({
        message: 'Title',
        description: 'Message',
        icon: expect.any(Object),
        duration: 3
      });
    });

    it('includes action button when provided', () => {
      const mockAction = {
        label: 'Action',
        onClick: jest.fn()
      };

      showToast({
        type: 'success',
        title: 'Title',
        message: 'Message',
        action: mockAction
      });

      expect(notification.success).toHaveBeenCalledWith({
        message: 'Title',
        description: 'Message',
        icon: expect.any(Object),
        duration: 4.5,
        btn: expect.any(Object)
      });
    });
  });

  describe('convenience functions', () => {
    it('toastSuccess calls showToast with success type', () => {
      toastSuccess('Success', 'Success message');
      
      expect(notification.success).toHaveBeenCalledWith({
        message: 'Success',
        description: 'Success message',
        icon: expect.any(Object),
        duration: 4.5
      });
    });

    it('toastError calls showToast with error type', () => {
      toastError('Error', 'Error message');
      
      expect(notification.error).toHaveBeenCalledWith({
        message: 'Error',
        description: 'Error message',
        icon: expect.any(Object),
        duration: 4.5
      });
    });

    it('toastWarning calls showToast with warning type', () => {
      toastWarning('Warning', 'Warning message');
      
      expect(notification.warning).toHaveBeenCalledWith({
        message: 'Warning',
        description: 'Warning message',
        icon: expect.any(Object),
        duration: 4.5
      });
    });

    it('toastInfo calls showToast with info type', () => {
      toastInfo('Info', 'Info message');
      
      expect(notification.info).toHaveBeenCalledWith({
        message: 'Info',
        description: 'Info message',
        icon: expect.any(Object),
        duration: 4.5
      });
    });
  });

  describe('clearAllToasts', () => {
    it('calls notification.destroy', () => {
      clearAllToasts();
      
      expect(notification.destroy).toHaveBeenCalled();
    });
  });
});