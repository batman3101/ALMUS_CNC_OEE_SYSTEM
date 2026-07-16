import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import {
  UserPreferencesProvider,
  useUserPreferences,
} from '@/contexts/UserPreferencesContext';

const mockUseAuth = jest.fn();
const mockUseSystemSettings = jest.fn();

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/contexts/SystemSettingsContext', () => ({
  useSystemSettings: () => mockUseSystemSettings(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn().mockResolvedValue({ error: null }),
  },
}));

function PreferencesProbe({
  renders,
}: {
  renders: Array<{ language: string; themeMode: string }>;
}) {
  const { language, themeMode } = useUserPreferences();
  renders.push({ language, themeMode });

  return <div data-testid="preferences">{`${language}/${themeMode}`}</div>;
}

describe('UserPreferencesProvider hydration contract', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('language', 'vi');
    localStorage.setItem('theme-mode', 'dark');

    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
    });
    mockUseSystemSettings.mockReturnValue({
      getSetting: jest.fn().mockReturnValue(null),
      isLoading: false,
    });
  });

  it('uses deterministic server defaults for the first render, then restores browser preferences', async () => {
    const renders: Array<{ language: string; themeMode: string }> = [];

    render(
      <UserPreferencesProvider>
        <PreferencesProbe renders={renders} />
      </UserPreferencesProvider>
    );

    expect(renders[0]).toEqual({
      language: 'ko',
      themeMode: 'light',
    });

    await waitFor(() => {
      expect(screen.getByTestId('preferences')).toHaveTextContent('vi/dark');
    });
  });
});
