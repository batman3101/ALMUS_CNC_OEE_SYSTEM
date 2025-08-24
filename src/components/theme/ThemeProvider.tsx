'use client';

import React, { useEffect } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import { useThemeSettings } from '@/hooks/useThemeSettings';

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const { antdTheme: customTheme } = useThemeSettings();
  
  return (
    <ConfigProvider theme={customTheme}>
      {children}
    </ConfigProvider>
  );
};