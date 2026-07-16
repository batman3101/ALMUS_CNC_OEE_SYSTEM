import { renderHook, waitFor } from '@testing-library/react';
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';

jest.mock('antd', () => {
  const contextNotification = {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
    open: jest.fn(),
    destroy: jest.fn(),
  };
  const contextMessage = {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
    loading: jest.fn(),
    open: jest.fn(),
    destroy: jest.fn(),
  };
  const staticNotification = {
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
  };

  return {
    App: {
      useApp: () => ({
        notification: contextNotification,
        message: contextMessage,
      }),
    },
    notification: staticNotification,
    message: contextMessage,
    __contextNotification: contextNotification,
    __staticNotification: staticNotification,
  };
});

const {
  __contextNotification: mockContextNotification,
  __staticNotification: mockStaticNotification,
} = jest.requireMock('antd') as {
  __contextNotification: {
    error: jest.Mock;
    warning: jest.Mock;
  };
  __staticNotification: {
    error: jest.Mock;
    warning: jest.Mock;
  };
};

describe('useRealtimeNotifications Ant Design context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens production alerts through the App notification instance', async () => {
    const props = {
      productionRecords: [],
      aggregatedData: {
        totalProduction: 1000,
        totalDefects: 0,
        avgOEE: 30,
        avgQuality: 100,
      },
    };
    const { result, unmount } = renderHook(() => useRealtimeNotifications(props));

    await waitFor(() => {
      expect(result.current.alerts.length).toBeGreaterThan(0);
    });

    expect(mockContextNotification.error).toHaveBeenCalled();
    expect(mockContextNotification.warning).toHaveBeenCalled();
    expect(mockStaticNotification.error).not.toHaveBeenCalled();
    expect(mockStaticNotification.warning).not.toHaveBeenCalled();

    unmount();
  });
});
