'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import { systemSettingsService, mapDbKeyToCodeKey } from '@/lib/systemSettings';
import { supabase } from '@/lib/supabase';
import type {
  AllSystemSettings,
  SettingUpdate,
  SettingCategory,
  SettingKey,
  SettingValueOf,
  GetSetting,
  GetSettingsByCategory
} from '@/types/systemSettings';

interface SystemSettingsContextType {
  settings: Partial<AllSystemSettings>;
  isLoading: boolean;
  error: string | null;
  
  // 설정 조회
  getSetting: GetSetting;
  getSettingsByCategory: GetSettingsByCategory;
  
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
  const getSetting = useCallback(<C extends SettingCategory, K extends SettingKey<C>>(
    category: C,
    key: K
  ): SettingValueOf<C, K> | null => {
    const categorySettings = settings[category] as AllSystemSettings[C] | undefined;
    if (!categorySettings) return null;

    return (categorySettings[key] as SettingValueOf<C, K>) ?? null;
  }, [settings]);

  /**
   * 카테고리별 설정 조회
   */
  const getSettingsByCategory = useCallback(<C extends SettingCategory>(category: C): Partial<AllSystemSettings[C]> => {
    return settings[category] ?? {};
  }, [settings]);

  /**
   * 단일 설정 업데이트
   */
  const updateSetting = useCallback(async (update: SettingUpdate): Promise<boolean> => {
    try {
      const result = await systemSettingsService.updateSetting(update);
      
      if (result.success) {
        // 로컬 상태 업데이트.
        // setting_key 는 DB 의 canonical key 이므로 코드 키로 매핑한 뒤 저장해야 한다.
        // 매핑 없이 저장하면 loadSettings() 가 매핑해 둔 키와 갈라져, 읽는 쪽이 옛 값을 계속 본다.
        setSettings(prev => {
          const categorySettings: Record<string, unknown> = { ...prev[update.category] };
          categorySettings[mapDbKeyToCodeKey(update.category, update.setting_key)] = update.setting_value;
          return {
            ...prev,
            [update.category]: categorySettings
          } as Partial<AllSystemSettings>;
        });
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
          const newSettings = { ...prev } as Record<string, Record<string, unknown>>;
          updates.forEach(update => {
            if (!newSettings[update.category]) {
              newSettings[update.category] = {};
            }
            newSettings[update.category][mapDbKeyToCodeKey(update.category, update.setting_key)] = update.setting_value;
          });
          return newSettings as Partial<AllSystemSettings>;
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
        const { category, key, value } = payload.payload as {
          category: SettingCategory;
          key: string;
          value: unknown;
        };

        // 브로드캐스트도 DB 의 canonical key 를 실어 나르므로 코드 키로 매핑해서 반영한다.
        setSettings(prev => {
          const categorySettings: Record<string, unknown> = { ...prev[category] };
          categorySettings[mapDbKeyToCodeKey(category, key)] = value;
          return {
            ...prev,
            [category]: categorySettings
          } as Partial<AllSystemSettings>;
        });
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

  // getSetting/getSettingsByCategory는 settings에, updateSetting/updateMultipleSettings는 []에,
  // resetCategory/resetAllSettings/refreshSettings는 loadSettings([])에 의존하는 고정 identity의
  // useCallback이므로, 이 value는 settings/isLoading/error/lastUpdated가 실제로 바뀔 때만
  // 새 identity를 얻는다 (LanguageProvider 등 하위 모든 useSystemSettings() 소비자의 연쇄 재렌더링 방지)
  const contextValue: SystemSettingsContextType = useMemo(() => ({
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
  }), [
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
  ]);

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