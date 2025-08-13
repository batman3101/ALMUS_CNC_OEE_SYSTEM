'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSystemSettings } from './useSystemSettings';

/**
 * 시스템 설정에 따른 자동 새로고침 훅
 */
export function useAutoRefresh(callback: () => void | Promise<void>, enabled: boolean = true) {
  const { getDisplaySettings } = useSystemSettings();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const callbackRef = useRef(callback);

  // 콜백 참조 업데이트
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // 자동 새로고침 설정
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const displaySettings = getDisplaySettings();
    const refreshInterval = displaySettings.refreshInterval * 1000; // 초를 밀리초로 변환

    // 기존 인터벌 클리어
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // 새 인터벌 설정
    intervalRef.current = setInterval(async () => {
      try {
        await callbackRef.current();
      } catch (error) {
        console.error('Auto refresh error:', error);
      }
    }, refreshInterval);

    // 클린업
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, getDisplaySettings]);

  // 수동 새로고침
  const refresh = useCallback(async () => {
    try {
      await callbackRef.current();
    } catch (error) {
      console.error('Manual refresh error:', error);
    }
  }, []);

  // 인터벌 일시 정지/재개
  const pause = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const resume = useCallback(() => {
    if (!enabled) return;
    
    const displaySettings = getDisplaySettings();
    const refreshInterval = displaySettings.refreshInterval * 1000;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(async () => {
      try {
        await callbackRef.current();
      } catch (error) {
        console.error('Auto refresh error:', error);
      }
    }, refreshInterval);
  }, [enabled, getDisplaySettings]);

  return {
    refresh,
    pause,
    resume,
    isActive: intervalRef.current !== null
  };
}