/**
 * 로컬 스토리지 유틸리티 함수들
 * SSR 환경에서 안전하게 사용할 수 있도록 구현
 */

// 로컬 스토리지 사용 가능 여부 확인
const isLocalStorageAvailable = (): boolean => {
  try {
    return typeof window !== 'undefined' && 'localStorage' in window;
  } catch {
    return false;
  }
};

// 로컬 스토리지에서 값 가져오기
export const getFromLocalStorage = (key: string): string | null => {
  if (!isLocalStorageAvailable()) {
    return null;
  }
  
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn(`Failed to get item from localStorage: ${key}`, error);
    return null;
  }
};

// 로컬 스토리지에 값 저장하기
export const setToLocalStorage = (key: string, value: string): boolean => {
  if (!isLocalStorageAvailable()) {
    return false;
  }
  
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Failed to set item to localStorage: ${key}`, error);
    return false;
  }
};

// 로컬 스토리지에서 값 제거하기
export const removeFromLocalStorage = (key: string): boolean => {
  if (!isLocalStorageAvailable()) {
    return false;
  }
  
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`Failed to remove item from localStorage: ${key}`, error);
    return false;
  }
};

// JSON 객체를 로컬 스토리지에 저장
export const setJsonToLocalStorage = (key: string, value: any): boolean => {
  try {
    const jsonString = JSON.stringify(value);
    return setToLocalStorage(key, jsonString);
  } catch (error) {
    console.warn(`Failed to stringify and save to localStorage: ${key}`, error);
    return false;
  }
};

// 로컬 스토리지에서 JSON 객체 가져오기
export const getJsonFromLocalStorage = <T = any>(key: string): T | null => {
  const value = getFromLocalStorage(key);
  if (!value) {
    return null;
  }
  
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn(`Failed to parse JSON from localStorage: ${key}`, error);
    return null;
  }
};

// 언어 설정 관련 특화 함수들
export const LANGUAGE_STORAGE_KEY = 'language';

export const getStoredLanguage = (): 'ko' | 'vi' | null => {
  const language = getFromLocalStorage(LANGUAGE_STORAGE_KEY);
  if (language === 'ko' || language === 'vi') {
    return language;
  }
  return null;
};

export const setStoredLanguage = (language: 'ko' | 'vi'): boolean => {
  return setToLocalStorage(LANGUAGE_STORAGE_KEY, language);
};