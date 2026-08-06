'use client';

import { useSystemSettings as useSystemSettingsContext } from '@/contexts/SystemSettingsContext';
import { useMemo, useEffect } from 'react';
import type { Dayjs } from 'dayjs';
import type { SettingCategory, AllSystemSettings } from '@/types/systemSettings';
import { resolveBreakMinutes, resolveShiftChangeBufferMinutes } from '@/lib/shiftDefaults';
import { resolveOEEGrade, resolveOEEGradingThresholds, type OEEGrade } from '@/lib/oeeGrading';
import { 
  initializeDateTimeFormatter, 
  getDateTimeFormatter,
  formatDate,
  formatTime,
  formatDateTime,
  formatRelative,
  formatCalendar,
  formatDateRange,
  formatCustom,
  parseDate,
  parseTime,
  parseDateTime,
  isValidDate,
  getCurrentTime,
  convertTimezone,
  getChartTimeFormat,
  calculateShiftTime,
  calculateWorkingHours
} from '@/utils/dateTimeUtils';

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
      name: context.getSetting('general', 'company_name') ?? 'ALMUS TECH',
      logo: context.getSetting('general', 'company_logo_url') ?? '',
      timezone: context.getSetting('general', 'timezone') ?? 'Asia/Ho_Chi_Minh',
      language: context.getSetting('general', 'language') ?? 'vi',
      dateFormat: context.getSetting('general', 'date_format') ?? 'DD/MM/YYYY',
      timeFormat: context.getSetting('general', 'time_format') ?? 'HH:mm:ss'
    }),

    /**
     * OEE 목표값 조회
     */
    getOEETargets: () => ({
      oee: context.getSetting('oee', 'target_oee') ?? 0.85,
      availability: context.getSetting('oee', 'target_availability') ?? 0.90,
      performance: context.getSetting('oee', 'target_performance') ?? 0.95,
      quality: context.getSetting('oee', 'target_quality') ?? 0.99
    }),

    /**
     * OEE 임계값 조회
     */
    getOEEThresholds: () => ({
      low: context.getSetting('oee', 'low_oee_threshold') ?? 0.60,
      critical: context.getSetting('oee', 'critical_oee_threshold') ?? 0.40,
      downtimeAlert: context.getSetting('oee', 'downtime_alert_minutes') ?? 30
    }),

    /**
     * 교대 시간 조회
     */
    /**
     * 교대 시간 조회.
     *
     * **종료 시각은 저장값을 읽지 않고 상대 교대의 시작에서 파생한다.**
     * 서버는 교대 창을 `A = [A시작, B시작)`, `B = [B시작, 다음날 A시작)` 으로 만들고
     * (`downtimeIntervals.buildShiftWindows`) 저장된 `shift_a_end`/`shift_b_end` 를 **읽지
     * 않는다**. 그런데 이 훅은 그 저장값을 읽고 있어서, 관리자가 예전 폼으로 A교대 종료를
     * 19:30 으로 바꿔 두었다면 화면은 19:30 을, 서버 OEE 는 20:00 을 기준으로 계산했다
     * (적대적 재감사 #9). 같은 화면 안에서 두 숫자가 다른 규칙을 따르는 상태다.
     *
     * 이 시스템의 실제 모델은 연속 2교대다 — A가 끝나면 B가 시작한다. 간격이나 중첩은
     * 표현할 수 없는 개념이므로, 종료 시각은 독립된 설정이 아니라 **파생값**이 맞다.
     */
    getShiftTimes: () => {
      const shiftAStart = context.getSetting('shift', 'shift_a_start') as string | undefined ?? '08:00';
      const shiftBStart = context.getSetting('shift', 'shift_b_start') as string | undefined ?? '20:00';
      return {
        shiftA: { start: shiftAStart, end: shiftBStart },
        shiftB: { start: shiftBStart, end: shiftAStart },
        breakTime: resolveBreakMinutes(context.getSetting('shift', 'break_time_minutes') as number | undefined),
        // 서버 기본값(shiftConfig)과 같은 상수를 쓴다. 예전에는 여기만 15 였다.
        bufferTime: resolveShiftChangeBufferMinutes(
          context.getSetting('shift', 'shift_change_buffer_minutes') as number | undefined)
      };
    },

    /**
     * 알림 설정 조회
     */
    getNotificationSettings: () => ({
      email: context.getSetting('notification', 'email_notifications_enabled') ?? false,
      browser: context.getSetting('notification', 'browser_notifications_enabled') ?? false,
      sound: context.getSetting('notification', 'sound_notifications_enabled') ?? false,
      checkInterval: context.getSetting('notification', 'alert_check_interval_seconds') ?? 60,
      emailAddress: context.getSetting('notification', 'notification_email') ?? ''
    }),

    /**
     * 화면 설정 조회
     */
    getDisplaySettings: () => ({
      mode: context.getSetting('display', 'theme_mode') ?? 'light',
      theme: {
        primary: context.getSetting('display', 'theme_primary_color') ?? '#1890ff',
        success: context.getSetting('display', 'theme_success_color') ?? '#52c41a',
        warning: context.getSetting('display', 'theme_warning_color') ?? '#faad14',
        error: context.getSetting('display', 'theme_error_color') ?? '#ff4d4f'
      },
      refreshInterval: context.getSetting('display', 'dashboard_refresh_interval_seconds') ?? 30,
      chartAnimation: context.getSetting('display', 'chart_animation_enabled') ?? true,
      compactMode: context.getSetting('display', 'compact_mode') ?? false,
      showMachineImages: context.getSetting('display', 'show_machine_images') ?? true,
      sidebarCollapsed: context.getSetting('display', 'sidebar_collapsed') ?? false
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
     *
     * 사다리는 `@/lib/oeeGrading` 한 곳에만 있다. 여기에 같은 규칙을 다시 적어 두었더니
     * 화면들이 각자 세 번째 사본을 만들었고, 그중 어느 것도 이 함수를 부르지 않았다.
     * 등급을 매길 수 없는 값은 `critical` 이 아니라 `null` 이다.
     */
    getOEEStatus: (oeeValue: number): OEEGrade | null =>
      resolveOEEGrade(oeeValue, resolveOEEGradingThresholds({
        target: context.getSetting('oee', 'target_oee'),
        low: context.getSetting('oee', 'low_oee_threshold'),
        critical: context.getSetting('oee', 'critical_oee_threshold'),
      })).grade,

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
     * 날짜/시간 포맷팅 함수들 (시스템 설정 기반)
     */
    formatDate: (date: Date | string) => formatDate(date),
    formatTime: (date: Date | string) => formatTime(date),
    formatDateTime: (date: Date | string) => formatDateTime(date),
    formatRelative: (date: Date | string) => formatRelative(date),
    formatCalendar: (date: Date | string) => formatCalendar(date),
    formatDateRange: (startDate: Date | string, endDate: Date | string) => 
      formatDateRange(startDate, endDate),
    formatCustom: (date: Date | string, format: string) => formatCustom(date, format),

    /**
     * 날짜/시간 파싱 함수들
     */
    parseDate: (dateString: string) => parseDate(dateString),
    parseTime: (timeString: string) => parseTime(timeString),
    parseDateTime: (dateTimeString: string) => parseDateTime(dateTimeString),
    isValidDate: (date: string | number | Date | Dayjs | null | undefined) => isValidDate(date),

    /**
     * 현재 시간 조회 (타임존 적용)
     */
    getCurrentTime: () => getCurrentTime(),

    /**
     * 타임존 변환
     */
    convertTimezone: (date: Date | string, targetTimezone: string) => 
      convertTimezone(date, targetTimezone),

    /**
     * 차트용 시간축 포맷
     */
    getChartTimeFormat: (granularity: 'minute' | 'hour' | 'day' | 'month') => 
      getChartTimeFormat(granularity),

    /**
     * 교대 시간 계산
     */
    calculateShiftTime: (baseDate: Date | string, shiftStart: string, shiftEnd: string) =>
      calculateShiftTime(baseDate, shiftStart, shiftEnd),

    /**
     * 업무 시간 계산 (휴식 시간 제외)
     */
    calculateWorkingHours: (
      startTime: Date | string, 
      endTime: Date | string, 
      breakMinutes: number = 0
    ) => calculateWorkingHours(startTime, endTime, breakMinutes),

    /**
     * Ant Design 컴포넌트용 날짜/시간 형식
     */
    getAntdDateFormat: () => getDateTimeFormatter().getAntdDateFormat(),
    getAntdTimeFormat: () => getDateTimeFormatter().getAntdTimeFormat(),

    /**
     * 레거시 지원: 기존 formatTimeWithTimezone 함수
     */
    formatTimeWithTimezone: (date: Date) => formatDateTime(date),

    /**
     * 언어별 포맷팅
     */
    formatNumber: (value: number, type: 'percentage' | 'decimal' | 'integer' = 'decimal') => {
      const language = context.getSetting('general', 'language') ?? 'ko';
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

  // 시스템 설정이 변경될 때마다 날짜/시간 포맷터 업데이트
  useEffect(() => {
    const companyInfo = helpers.getCompanyInfo();
    
    initializeDateTimeFormatter({
      timezone: companyInfo.timezone,
      dateFormat: companyInfo.dateFormat,
      timeFormat: companyInfo.timeFormat,
      language: companyInfo.language
    });
  }, [context.settings, helpers]);

  return {
    ...context,
    ...helpers
  };
}

/**
 * 특정 카테고리 설정만 사용하는 훅
 */
export function useCategorySettings<T extends SettingCategory>(category: T) {
  const { getSettingsByCategory, updateSetting, updateMultipleSettings, resetCategory } = useSystemSettings();
  
  return {
    settings: getSettingsByCategory(category) as AllSystemSettings[T],
    updateSetting: (key: string, value: unknown, reason?: string) =>
      updateSetting({ category, setting_key: key, setting_value: value, change_reason: reason }),
    updateMultipleSettings: (updates: Array<{ key: string; value: unknown; reason?: string }>) =>
      updateMultipleSettings(updates.map(update => ({
        category,
        setting_key: update.key,
        setting_value: update.value,
        change_reason: update.reason
      }))),
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