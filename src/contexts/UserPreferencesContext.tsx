'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';
import { useSystemSettings } from './SystemSettingsContext';
import { getStoredLanguage, setStoredLanguage } from '@/utils/localStorage';

/**
 * 개인 환경설정(언어/테마)의 단일 출처.
 *
 * ■ 왜 따로 두는가
 *   예전에는 언어 토글과 테마 토글이 system_settings 의 default_language / theme_mode 를
 *   직접 수정했다. 그런데 system_settings 에는 user_id 가 없다 — 회사 전체가 공유하는 전역 행이다.
 *   게다가 SystemSettingsContext 는 변경을 Realtime 으로 모든 클라이언트에 전파한다. 그래서
 *     - A 가 한국어로 바꾸면 B 화면도 한국어가 됐고,
 *     - A 와 B 가 서로 다른 언어를 원하면 같은 행을 서로 되돌려 쓰며 무한히 뒤집혔다.
 *   "한국어로 바꿔도 몇 초 뒤 베트남어로 돌아간다"의 진짜 원인이 이것이다.
 *
 * ■ 규칙
 *   1. 값의 출처 우선순위 (사용자 신원이 바뀔 때마다 한 번 확정):
 *        로그인 상태  : 내 프로필 설정 > 시스템 기본값 > 하드코딩 기본
 *        비로그인 상태: localStorage(직전 선택 캐시) > 시스템 기본값 > 하드코딩 기본
 *      (localStorage 는 브라우저 전역이라 로그인 사용자에게는 앞 사용자의 값이 될 수 있으므로 쓰지 않는다)
 *   2. 한 번 확정된 뒤에는 "사용자의 선택"만이 값을 바꾼다.
 *      시스템 설정이 나중에 바뀌어도 사용 중인 사용자를 덮어쓰지 않는다.
 *      (시스템 설정은 "앱을 처음 열었을 때의 기본값"이지, 사용 중 강제되는 값이 아니다)
 *   3. 저장은 user_profiles 의 내 행에만 한다(update_my_preferences RPC).
 *      전역 설정은 건드리지 않으므로 다른 사용자에게 전파되지 않는다.
 */

export type LanguageCode = 'ko' | 'vi';
export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'theme-mode';

interface UserPreferencesContextType {
  language: LanguageCode;
  themeMode: ThemeMode;
  /** 초기값 확정 여부. false 면 아직 프로필/시스템 설정을 기다리는 중이다. */
  isResolved: boolean;
  setLanguage: (lang: LanguageCode) => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
}

const UserPreferencesContext = createContext<UserPreferencesContextType | undefined>(undefined);

export const useUserPreferences = () => {
  const ctx = useContext(UserPreferencesContext);
  if (!ctx) {
    throw new Error('useUserPreferences must be used within a UserPreferencesProvider');
  }
  return ctx;
};

function getStoredTheme(): ThemeMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function setStoredTheme(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* 사파리 프라이빗 모드 등에서 실패할 수 있으나 치명적이지 않다 */
  }
}

/**
 * 내 개인 설정을 DB 에 저장한다. 실패해도 화면의 선택은 되돌리지 않는다.
 *
 * 저장 실패로 사용자의 선택을 롤백하면, 예전처럼 "눌렀는데 되돌아가는" 경험이 된다.
 * 화면은 사용자의 의도를 따르고, 저장은 best-effort 로 처리한 뒤 실패를 로그로 남긴다.
 * (다음 로그인 때 서버 값으로 복원되므로 데이터가 어긋난 채 굳지 않는다)
 */
async function persistPreference(patch: { language?: LanguageCode; theme_mode?: ThemeMode }): Promise<void> {
  const { error } = await supabase.rpc('update_my_preferences', {
    p_language: patch.language ?? null,
    p_theme_mode: patch.theme_mode ?? null,
  });
  if (error) {
    console.error('개인 설정 저장 실패 (화면 선택은 유지됨):', error.message);
  }
}

export const UserPreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const { getSetting, isLoading: settingsLoading } = useSystemSettings();

  // localStorage 값으로 먼저 그려서 첫 페인트의 깜빡임을 줄인다.
  const [language, setLanguageState] = useState<LanguageCode>(() => getStoredLanguage() ?? 'ko');
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getStoredTheme() ?? 'light');
  const [isResolved, setIsResolved] = useState(false);

  // 초기값은 "사용자 신원당 한 번"만 확정한다.
  //   undefined = 아직 확정 전, null = 비로그인 상태로 확정됨, string = 해당 사용자로 확정됨
  // 예전처럼 boolean 으로 잠그면, 로그인 화면(비로그인)에서 이미 확정돼 버려서
  // 로그인(SPA 전환, 리마운트 없음) 후 프로필이 도착해도 다시 확정하지 못했다.
  // → 매 로그인마다 DB 프로필의 언어/테마가 무시되고, 같은 PC에서 앞 사용자의 값이 그대로 남았다.
  // 신원을 기록해두면 (null -> id, id -> 다른 id) 전환 시에만 다시 확정하므로,
  // "시스템 설정 변경이 사용 중인 사용자를 덮어쓰지 않는다"는 기존 보호 성질은 그대로 유지된다.
  const resolvedUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // 프로필과 시스템 기본값이 모두 준비되기 전에 확정하면 잘못된 값으로 굳는다.
    if (authLoading || settingsLoading) return;

    const currentUserId = user?.id ?? null;
    if (resolvedUserIdRef.current === currentUserId) return;

    const systemLanguage = getSetting('general', 'language') as LanguageCode | null;
    const systemTheme = getSetting('display', 'theme_mode') as ThemeMode | null;

    // localStorage 는 브라우저 전역(사용자별이 아님)이라 이전 사용자의 값이 남아있을 수 있다.
    // 그래서 로그인 상태에서는 내 프로필 > 시스템 기본값 순으로만 확정하고, localStorage 는 보지 않는다.
    // 비로그인 방문자만 직전 선택 캐시(localStorage)를 사용한다.
    const initialLanguage: LanguageCode = user
      ? (user.language ?? systemLanguage ?? 'ko')
      : (getStoredLanguage() ?? systemLanguage ?? 'ko');
    const initialTheme: ThemeMode = user
      ? (user.theme_mode ?? systemTheme ?? 'light')
      : (getStoredTheme() ?? systemTheme ?? 'light');

    setLanguageState(initialLanguage);
    setThemeModeState(initialTheme);
    setStoredLanguage(initialLanguage);
    setStoredTheme(initialTheme);

    resolvedUserIdRef.current = currentUserId;
    setIsResolved(true);
  }, [authLoading, settingsLoading, user, getSetting]);

  const setLanguage = useCallback(async (lang: LanguageCode) => {
    if (lang === language) return;
    // 화면과 로컬 캐시를 먼저 바꾼다. 사용자의 선택이 최우선이다.
    setLanguageState(lang);
    setStoredLanguage(lang);
    if (user) {
      await persistPreference({ language: lang });
    }
  }, [language, user]);

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    if (mode === themeMode) return;
    setThemeModeState(mode);
    setStoredTheme(mode);
    if (user) {
      await persistPreference({ theme_mode: mode });
    }
  }, [themeMode, user]);

  const value = useMemo<UserPreferencesContextType>(() => ({
    language,
    themeMode,
    isResolved,
    setLanguage,
    setThemeMode,
  }), [language, themeMode, isResolved, setLanguage, setThemeMode]);

  return (
    <UserPreferencesContext.Provider value={value}>
      {children}
    </UserPreferencesContext.Provider>
  );
};
