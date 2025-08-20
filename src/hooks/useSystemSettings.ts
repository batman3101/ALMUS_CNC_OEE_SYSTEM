'use client';

import { useSystemSettings as useSystemSettingsContext } from '@/contexts/SystemSettingsContext';
import { useMemo } from 'react';
import type { SettingCategory, AllSystemSettings } from '@/types/systemSettings';

/**
 * 시스템 설정 커스텀 훅
 * 다양한 편의 기능을 제공하는 확장된 훅
 */
export function useSystemSettings() {
  const context = useSystemSettingsContext();

  // 편의 메서드들
  const helpers = useMemo(() => ({
    /**
     * 회사 정보 조회
     */
    getCompanyInfo: () => ({
      name: context.getSetting('general', 'company_name') || 'CNC Manufacturing Co.',
      logo: context.getSetting('general', 'company_logo_url') || '',
      timezone: context.getSetting('general', 'timezone') || 'Asia/Seoul',
      language: context.getSetting('general', 'language') || 'ko'
    }),

    /**
     * OEE 목표값 조회
     */
    getOEETargets: () => ({
      oee: context.getSetting('oee', 'target_oee') || 0.85,
      availability: context.getSetting('oee', 'target_availability') || 0.90,
      performance: context.getSetting('oee', 'target_performance') || 0.95,
      quality: context.getSetting('oee', 'target_quality') || 0.99
    }),

    /**
     * OEE 임계값 조회
     */
    getOEEThresholds: () => ({
      low: context.getSetting('oee', 'low_oee_threshold') || 0.60,
      critical: context.getSetting('oee', 'critical_oee_threshold') || 0.40,
      downtimeAlert: context.getSetting('oee', 'downtime_alert_minutes') || 30
    }),

    /**
     * 교대 시간 조회
     */
    getShiftTimes: () => ({
      shiftA: {
        start: context.getSetting('shift', 'shift_a_start') || '08:00',
        end: context.getSetting('shift', 'shift_a_end') || '20:00'
      },
      shiftB: {
        start: context.getSetting('shift', 'shift_b_start') || '20:00',
        end: context.getSetting('shift', 'shift_b_end') || '08:00'
      },
      breakTime: context.getSetting('shift', 'break_time_minutes') || 60,
      bufferTime: context.getSetting('shift', 'shift_change_buffer_minutes') || 15
    }),

    /**
     * 알림 설정 조회
     */
    getNotificationSettings: () => ({
      email: context.getSetting('notification', 'email_notifications_enabled') || false,
      browser: context.getSetting('notification', 'browser_notifications_enabled') || false,
      sound: context.getSetting('notification', 'sound_notifications_enabled') || false,
      checkInterval: context.getSetting('notification', 'alert_check_interval_seconds') || 60,
      emailAddress: context.getSetting('notification', 'notification_email') || ''
    }),

    /**
     * 화면 설정 조회
     */
    getDisplaySettings: () => ({
      mode: context.getSetting('display', 'theme_mode') || 'light',
      theme: {
        primary: context.getSetting('display', 'theme_primary_color') || '#1890ff',
        success: context.getSetting('display', 'theme_success_color') || '#52c41a',
        warning: context.getSetting('display', 'theme_warning_color') || '#faad14',
        error: context.getSetting('display', 'theme_error_color') || '#ff4d4f'
      },
      refreshInterval: context.getSetting('display', 'dashboard_refresh_interval_seconds') || 30,
      chartAnimation: context.getSetting('display', 'chart_animation_enabled') || true,
      compactMode: context.getSetting('display', 'compact_mode') || false,
      showMachineImages: context.getSetting('display', 'show_machine_images') || true,
      sidebarCollapsed: context.getSetting('display', 'sidebar_collapsed') || false
    }),

    /**
     * 현재 교대 계산
     */
    getCurrentShift: () => {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const shiftTimes = helpers.getShiftTimes();
      
      // A교대 시간 체크 (08:00 - 20:00)
      if (currentTime >= shiftTimes.shiftA.start && currentTime < shiftTimes.shiftA.end) {
        return 'A';
      }
      // B교대 시간 체크 (20:00 - 08:00 다음날)
      else {
        return 'B';
      }
    },

    /**
     * OEE 상태 계산 (목표 대비)
     */
    getOEEStatus: (oeeValue: number) => {
      const thresholds = helpers.getOEEThresholds();
      const targets = helpers.getOEETargets();
      
      if (oeeValue >= targets.oee) return 'excellent';
      if (oeeValue >= thresholds.low) return 'good';
      if (oeeValue >= thresholds.critical) return 'warning';
      return 'critical';
    },

    /**
     * 색상 테마 적용
     */
    applyThemeColors: () => {
      const displaySettings = helpers.getDisplaySettings();
      const root = document.documentElement;
      
      root.style.setProperty('--ant-primary-color', displaySettings.theme.primary);
      root.style.setProperty('--ant-success-color', displaySettings.theme.success);
      root.style.setProperty('--ant-warning-color', displaySettings.theme.warning);
      root.style.setProperty('--ant-error-color', displaySettings.theme.error);
    },

    /**
     * 시간대 변환
     */
    formatTimeWithTimezone: (date: Date) => {
      const timezone = context.getSetting('general', 'timezone') || 'Asia/Seoul';
      return new Intl.DateTimeFormat('ko-KR', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(date);
    },

    /**
     * 언어별 포맷팅
     */
    formatNumber: (value: number, type: 'percentage' | 'decimal' | 'integer' = 'decimal') => {
      const language = context.getSetting('general', 'language') || 'ko';
      const locale = language === 'ko' ? 'ko-KR' : 'vi-VN';
      
      switch (type) {
        case 'percentage':
          return new Intl.NumberFormat(locale, {
            style: 'percent',
            minimumFractionDigits: 1,
            maximumFractionDigits: 1
          }).format(value);
        case 'integer':
          return new Intl.NumberFormat(locale).format(Math.round(value));
        default:
          return new Intl.NumberFormat(locale, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 2
          }).format(value);
      }
    }
  }), [context]);

  return {
    ...context,
    ...helpers
  };
}

/**
 * 특정 카테고리 설정만 사용하는 훅
 */
export function useCategorySettings<T extends SettingCategory>(category: T) {
  const { getSettingsByCategory, updateSetting, resetCategory } = useSystemSettings();
  
  return {
    settings: getSettingsByCategory(category) as AllSystemSettings[T],
    updateSetting: (key: string, value: any, reason?: string) => 
      updateSetting({ category, setting_key: key, setting_value: value, change_reason: reason }),
    resetSettings: () => resetCategory(category)
  };
}

/**
 * OEE 설정 전용 훅
 */
export function useOEESettings() {
  return useCategorySettings('oee');
}

/**
 * 화면 설정 전용 훅
 */
export function useDisplaySettings() {
  return useCategorySettings('display');
}

/**
 * 알림 설정 전용 훅
 */
export function useNotificationSettings() {
  return useCategorySettings('notification');
}

/**
 * 교대 설정 전용 훅
 */
export function useShiftSettings() {
  return useCategorySettings('shift');
}

/**
 * 일반 설정 전용 훅
 */
export function useGeneralSettings() {
  return useCategorySettings('general');
}