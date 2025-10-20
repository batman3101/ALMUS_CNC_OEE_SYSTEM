'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { systemSettingsService } from '@/lib/systemSettings';
import { supabase } from '@/lib/supabase';
import type {
  AllSystemSettings,
  SettingUpdate,
  SettingCategory,
  SystemSetting
} from '@/types/systemSettings';

interface SystemSettingsContextType {
  settings: Partial<AllSystemSettings>;
  isLoading: boolean;
  error: string | null;
  
  // 설정 조회
  getSetting: <T = any>(category: SettingCategory, key: string) => T | null;
  getSettingsByCategory: (category: SettingCategory) => Record<string, any>;
  
  // 설정 업데이트
  updateSetting: (update: SettingUpdate) => Promise<boolean>;
  updateMultipleSettings: (updates: SettingUpdate[]) => Promise<boolean>;
  
  // 설정 초기화
  resetCategory: (category: SettingCategory) => Promise<boolean>;
  resetAllSettings: () => Promise<boolean>;
  
  // 캐시 관리
  refreshSettings: () => Promise<void>;
  
  // 상태
  lastUpdated: Date | null;
}

const SystemSettingsContext = createContext<SystemSettingsContextType | undefined>(undefined);

interface SystemSettingsProviderProps {
  children: ReactNode;
}

export function SystemSettingsProvider({ children }: SystemSettingsProviderProps) {
  const [settings, setSettings] = useState<Partial<AllSystemSettings>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  /**
   * 설정 데이터 로드
   */
  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const structuredSettings = await systemSettingsService.getStructuredSettings();
      
      // 설정이 비어있지 않은지 확인
      if (structuredSettings && Object.keys(structuredSettings).length > 0) {
        setSettings(structuredSettings);
        setLastUpdated(new Date());
      } else {
        console.warn('No settings loaded, using empty state');
        setSettings({});
      }
    } catch (err) {
      console.error('Error loading system settings:', err);
      setError('Failed to load system settings');
      // 오류 발생 시에도 빈 설정으로 초기화
      setSettings({});
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * 특정 설정값 조회
   */
  const getSetting = useCallback(<T = any>(category: SettingCategory, key: string): T | null => {
    const categorySettings = settings[category];
    if (!categorySettings) return null;
    
    return categorySettings[key] as T || null;
  }, [settings]);

  /**
   * 카테고리별 설정 조회
   */
  const getSettingsByCategory = useCallback((category: SettingCategory): Record<string, any> => {
    return settings[category] || {};
  }, [settings]);

  /**
   * 단일 설정 업데이트
   */
  const updateSetting = useCallback(async (update: SettingUpdate): Promise<boolean> => {
    try {
      const result = await systemSettingsService.updateSetting(update);
      
      if (result.success) {
        // 로컬 상태 업데이트
        setSettings(prev => ({
          ...prev,
          [update.category]: {
            ...prev[update.category],
            [update.setting_key]: update.setting_value
          }
        }));
        setLastUpdated(new Date());
        return true;
      } else {
        setError(result.error || 'Failed to update setting');
        return false;
      }
    } catch (err) {
      console.error('Error updating setting:', err);
      setError('Failed to update setting');
      return false;
    }
  }, []);

  /**
   * 여러 설정 일괄 업데이트
   */
  const updateMultipleSettings = useCallback(async (updates: SettingUpdate[]): Promise<boolean> => {
    try {
      const result = await systemSettingsService.updateMultipleSettings(updates);
      
      if (result.success) {
        // 로컬 상태 업데이트
        setSettings(prev => {
          const newSettings = { ...prev };
          updates.forEach(update => {
            if (!newSettings[update.category]) {
              newSettings[update.category] = {};
            }
            newSettings[update.category][update.setting_key] = update.setting_value;
          });
          return newSettings;
        });
        setLastUpdated(new Date());
        return true;
      } else {
        setError(result.error || 'Failed to update settings');
        return false;
      }
    } catch (err) {
      console.error('Error updating multiple settings:', err);
      setError('Failed to update settings');
      return false;
    }
  }, []);

  /**
   * 카테고리 설정 초기화
   */
  const resetCategory = useCallback(async (category: SettingCategory): Promise<boolean> => {
    try {
      const result = await systemSettingsService.resetToDefaults(category);
      
      if (result.success) {
        await loadSettings(); // 전체 설정 다시 로드
        return true;
      } else {
        setError(result.error || 'Failed to reset category settings');
        return false;
      }
    } catch (err) {
      console.error('Error resetting category settings:', err);
      setError('Failed to reset category settings');
      return false;
    }
  }, [loadSettings]);

  /**
   * 모든 설정 초기화
   */
  const resetAllSettings = useCallback(async (): Promise<boolean> => {
    try {
      const result = await systemSettingsService.resetToDefaults();
      
      if (result.success) {
        await loadSettings(); // 전체 설정 다시 로드
        return true;
      } else {
        setError(result.error || 'Failed to reset all settings');
        return false;
      }
    } catch (err) {
      console.error('Error resetting all settings:', err);
      setError('Failed to reset all settings');
      return false;
    }
  }, [loadSettings]);

  /**
   * 설정 새로고침
   */
  const refreshSettings = useCallback(async (): Promise<void> => {
    await loadSettings();
  }, [loadSettings]);

  /**
   * 실시간 설정 변경 구독
   */
  useEffect(() => {
    const channel = supabase
      .channel('system_settings_changes')
      .on('broadcast', { event: 'setting_changed' }, (payload) => {
        const { category, key, value } = payload.payload;
        
        // 로컬 상태 업데이트
        setSettings(prev => ({
          ...prev,
          [category]: {
            ...prev[category],
            [key]: value
          }
        }));
        setLastUpdated(new Date());
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  /**
   * 초기 설정 로드
   */
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  /**
   * 에러 자동 클리어
   */
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const contextValue: SystemSettingsContextType = {
    settings,
    isLoading,
    error,
    getSetting,
    getSettingsByCategory,
    updateSetting,
    updateMultipleSettings,
    resetCategory,
    resetAllSettings,
    refreshSettings,
    lastUpdated
  };

  return (
    <SystemSettingsContext.Provider value={contextValue}>
      {children}
    </SystemSettingsContext.Provider>
  );
}

/**
 * 시스템 설정 훅
 */
export function useSystemSettings() {
  const context = useContext(SystemSettingsContext);
  if (context === undefined) {
    throw new Error('useSystemSettings must be used within a SystemSettingsProvider');
  }
  return context;
}