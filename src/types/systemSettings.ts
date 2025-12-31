// 시스템 설정 관련 타입 정의

export type SettingValueType = 'string' | 'number' | 'boolean' | 'json' | 'color' | 'time';

export type SettingCategory = 'general' | 'oee' | 'notification' | 'display' | 'shift';

export interface SystemSetting {
  id: string;
  category: SettingCategory;
  setting_key: string;
  setting_value: string | number | boolean | object | unknown[];
  default_value: string | number | boolean | object | unknown[];
  description?: string;
  data_type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  validation_rules?: Record<string, unknown>;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface SystemSettingAudit {
  id: string;
  setting_id: string;
  category: SettingCategory;
  setting_key: string;
  old_value?: unknown;
  new_value: unknown;
  changed_by?: string;
  changed_at: string;
  change_reason?: string;
}

export interface SettingUpdate {
  category: SettingCategory;
  setting_key: string;
  setting_value: unknown;
  change_reason?: string;
}

export interface SettingsGroup {
  category: SettingCategory;
  settings: Record<string, unknown>;
}

// 카테고리별 설정 인터페이스
export interface GeneralSettings {
  company_name: string;
  company_logo_url: string;
  timezone: string;
  language: string;
  date_format: string;
  time_format: string;
}

export interface OEESettings {
  target_oee: number;
  target_availability: number;
  target_performance: number;
  target_quality: number;
  low_oee_threshold: number;
  critical_oee_threshold: number;
  downtime_alert_minutes: number;
}

export interface ShiftSettings {
  shift_a_start: string;
  shift_a_end: string;
  shift_b_start: string;
  shift_b_end: string;
  break_time_minutes: number;
  shift_change_buffer_minutes: number;
}

export interface NotificationSettings {
  email_notifications_enabled: boolean;
  browser_notifications_enabled: boolean;
  sound_notifications_enabled: boolean;
  notification_email: string;
  alert_check_interval_seconds: number;
}

export interface DisplaySettings {
  theme_mode: 'light' | 'dark';
  theme_primary_color: string;
  theme_success_color: string;
  theme_warning_color: string;
  theme_error_color: string;
  dashboard_refresh_interval_seconds: number;
  chart_animation_enabled: boolean;
  compact_mode: boolean;
  show_machine_images: boolean;
  sidebar_collapsed: boolean;
}

export interface AllSystemSettings {
  general: GeneralSettings;
  oee: OEESettings;
  shift: ShiftSettings;
  notification: NotificationSettings;
  display: DisplaySettings;
}

// 설정 검증 규칙
export interface SettingValidationRule {
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  validator?: (value: unknown) => boolean | string;
}

export interface SettingDefinition {
  key: string;
  category: SettingCategory;
  value_type: SettingValueType;
  default_value: unknown;
  description: string;
  validation?: SettingValidationRule;
  is_system: boolean;
}

// API 응답 타입들
export interface SettingsResponse {
  success: boolean;
  data?: SystemSetting[];
  error?: string;
}

export interface SettingUpdateResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface SettingsAuditResponse {
  success: boolean;
  data?: SystemSettingAudit[];
  error?: string;
}