import React from 'react';
import { act, render } from '@testing-library/react';
import {
  showToast,
  ToastNotificationProvider,
} from '@/components/notifications/ToastNotification';

jest.mock('antd', () => {
  const contextNotification = {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
    open: jest.fn(),
    destroy: jest.fn(),
  };
  const staticNotification = {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
    open: jest.fn(),
    destroy: jest.fn(),
    config: jest.fn(),
  };

  return {
    App: {
      useApp: () => ({
        notification: contextNotification,
      }),
    },
    notification: staticNotification,
    __contextNotification: contextNotification,
    __staticNotification: staticNotification,
  };
});

const {
  __contextNotification: mockContextNotification,
  __staticNotification: mockStaticNotification,
} = jest.requireMock('antd') as {
  __contextNotification: {
    success: jest.Mock;
  };
  __staticNotification: {
    success: jest.Mock;
  };
};

describe('ToastNotificationProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the notification instance from App context instead of the static API', () => {
    render(
      <ToastNotificationProvider>
        <div>child</div>
      </ToastNotificationProvider>
    );

    act(() => {
      showToast({
        type: 'success',
        title: '완료',
        message: '알림을 확인했습니다.',
      });
    });

    expect(mockContextNotification.success).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '완료',
        description: '알림을 확인했습니다.',
      })
    );
    expect(mockStaticNotification.success).not.toHaveBeenCalled();
  });
});
