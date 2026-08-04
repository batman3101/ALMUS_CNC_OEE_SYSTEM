'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import { systemSettingsService, mapDbKeyToCodeKey } from '@/lib/systemSettings';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
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
  // providers.tsx 에서 AuthProvider 안쪽에 있으므로 인증 상태를 읽을 수 있다.
  const { user, loading: authLoading } = useAuth();
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
   * 실시간 설정 변경 구독.
   *
   * ## broadcast 는 **신호로만** 쓴다 — 값은 싣고 오더라도 믿지 않는다
   *
   * 예전에는 payload 의 `category`/`key`/`value` 를 그대로 전역 설정에 넣었다. 이 채널은
   * private 설정 없이 열려 있어서, 프로젝트가 public channel 을 허용하는 구성이라면 아무나
   * 같은 토픽으로 `setting_changed` 를 쏘아 교대 시작 시각·휴식 시간·OEE 임계값을 **화면에서만**
   * 바꿀 수 있었다. DB 는 안전하다(`system_settings` 는 authenticated 에게 SELECT 만, 쓰기는
   * `is_admin()` 정책). 훼손되는 것은 **화면이 믿는 값**이고, 그건 계획가동·성능 계산의
   * 전제라 화면마다 다른 숫자를 보게 된다.
   *
   * 그래서 payload 를 읽지 않고 "무언가 바뀌었다"는 사실만 받아 **DB 에서 다시 읽는다.**
   * 위조된 신호가 할 수 있는 최대치가 "불필요한 재조회 한 번"으로 줄어든다 — 그건 손해가
   * 아니다. 채널을 private 으로 만드는 방법도 있지만, 값을 믿지 않는 쪽이 프로젝트의
   * Realtime 설정에 의존하지 않아 더 확실하다.
   *
   * 재조회는 `loadSettings` 가 하며, 그 안에서 인증·권한을 다시 거친다.
   */
  useEffect(() => {
    const channel = supabase
      .channel('system_settings_changes')
      .on('broadcast', { event: 'setting_changed' }, () => {
        void loadSettings();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadSettings]);

  /**
   * 초기 설정 로드 — **로그인이 끝난 뒤에만** 조회한다.
   *
   * 예전에는 마운트 즉시 조회했다. 그런데 그 시점에는 Supabase 세션 복원이 아직 끝나지
   * 않아 요청이 **익명 역할**로 나갔고, 2026-07-29 에 익명 권한을 회수한 뒤로는 매번
   * `42501 permission denied for table system_settings` 가 콘솔에 찍혔다(실측: 익명 401,
   * 로그인 세션 200 — 같은 URL). 조회가 실패했으므로 설정도 못 받았다.
   *
   * 없는 권한으로 두드려 보고 실패를 기록하는 대신, 조회할 수 있게 된 뒤에 조회한다.
   *
   * ⚠️ 로그인 전에는 설정이 비어 있고 화면은 기본값을 쓴다. 로그인 페이지의 회사명도
   * 마찬가지다 — 회수 이후로 이미 그랬고(요청이 실패했으므로), 이 변경은 그 사실을
   * 오류 없이 드러낼 뿐이다. 로그인 화면에 설정된 브랜딩을 띄우려면 회사 정보만 내려주는
   * 좁은 공개 엔드포인트가 필요하다 — 설정 테이블 전체를 익명에 다시 여는 것은 답이 아니다.
   */
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // 로그인하지 않은 상태는 "아직 모름"이 아니라 "받을 수 없음"이다. 로딩을 끝내지
      // 않으면 로그인 화면이 스피너에 갇힌다.
      setSettings({});
      setIsLoading(false);
      return;
    }
    loadSettings();
  }, [authLoading, user, loadSettings]);

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