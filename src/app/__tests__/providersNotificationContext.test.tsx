import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Providers } from '@/app/providers';
import { showToast } from '@/components/notifications';

jest.mock('react-i18next', () => ({
  I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/lib/i18n', () => ({}));

jest.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/contexts/SystemSettingsContext', () => ({
  SystemSettingsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/contexts/UserPreferencesContext', () => ({
  UserPreferencesProvider: ({ children }: { children: React.ReactNode }) => children,
  useUserPreferences: () => ({
    language: 'vi',
    themeMode: 'dark',
  }),
}));

jest.mock('@/contexts/LanguageContext', () => ({
  LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/contexts/DateRangeContext', () => ({
  DateRangeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/contexts/NotificationContext', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/components/theme/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/hooks/useSystemSettings', () => ({
  useSystemSettings: () => ({
    getDisplaySettings: () => ({
      theme: {
        primary: '#1677ff',
        success: '#52c41a',
        warning: '#faad14',
        error: '#ff4d4f',
      },
    }),
  }),
}));

describe('Providers notification context', () => {
  it('renders toast notifications through the themed Ant Design App context without a static API warning', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <Providers>
        <button
          type="button"
          onClick={() =>
            showToast({
              type: 'success',
              title: '완료',
              message: '알림을 확인했습니다.',
            })
          }
        >
          toast
        </button>
      </Providers>
    );

    fireEvent.click(screen.getByRole('button', { name: 'toast' }));

    await waitFor(() => {
      expect(screen.getByText('알림을 확인했습니다.')).toBeInTheDocument();
    });

    expect(
      consoleError.mock.calls.some((args) =>
        args.some(
          (value) =>
            typeof value === 'string' &&
            value.includes('Static function can not consume context')
        )
      )
    ).toBe(false);

    consoleError.mockRestore();
  });
});
