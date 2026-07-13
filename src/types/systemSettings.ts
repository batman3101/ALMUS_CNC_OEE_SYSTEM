// 시스템 설정 관련 타입 정의

export type SettingValueType = 'string' | 'number' | 'boolean' | 'json' | 'color' | 'time';

export type SettingCategory = 'general' | 'oee' | 'notification' | 'display' | 'shift';

export interface SystemSetting {
  id: string;
  category: SettingCategory;
  setting_key: string;
  // DB 상 jsonb 이므로 임의의 JSON 값이 올 수 있다. 사용처에서 좁혀 쓸 것.
  setting_value: unknown;
  default_value: unknown;
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

// `recent_settings_changes` 뷰의 행 (systemSettings.getSettingsAudit 가 이 뷰를 조회한다)
export interface SystemSettingAudit {
  id: string;
  setting_id: string;
  category: SettingCategory;
  setting_key: string;
  old_value?: unknown;
  new_value: unknown;
  action?: string;               // INSERT / UPDATE / DELETE
  changed_by?: string;
  changed_at: string;
  change_reason?: string;
  // 아래 필드는 뷰가 user_profiles 를 조인해 제공한다
  changed_by_name?: string | null;
  changed_by_email?: string | null;
  description?: string | null;
  data_type?: string | null;
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

// ---------------------------------------------------------------------------
// 타입 안전한 설정 접근자
//
// 기존 시그니처 `getSetting<T = unknown>(category, key): T | null` 은 타입 인자를
// 생략하고 호출하면 T 가 `unknown` 으로 고정되고, `getSetting(...) ?? 60` 처럼
// nullish 병합을 하면 TS 가 `unknown` 에서 null/undefined 를 제거해 `{}` 로 좁힌다.
// 그 결과 `breakTime` 등이 `{}` 가 되어 산술/문자열 연산에서 전부 터졌다.
//
// 아래처럼 category 와 key 로부터 값 타입을 **추론**하게 하면 타입 인자를 명시하지
// 않아도 정확한 타입이 나온다:
//   getSetting('shift', 'break_time_minutes')  // number | null
//   getSetting('display', 'theme_mode')        // 'light' | 'dark' | null
// ---------------------------------------------------------------------------

/** 해당 카테고리에서 사용할 수 있는 설정 키 */
export type SettingKey<C extends SettingCategory> = Extract<keyof AllSystemSettings[C], string>;

/** category + key 조합의 값 타입 */
export type SettingValueOf<
  C extends SettingCategory,
  K extends SettingKey<C>
> = AllSystemSettings[C][K];

/** SystemSettingsContext.getSetting 의 시그니처 */
export type GetSetting = <C extends SettingCategory, K extends SettingKey<C>>(
  category: C,
  key: K
) => SettingValueOf<C, K> | null;

/** SystemSettingsContext.getSettingsByCategory 의 시그니처 */
export type GetSettingsByCategory = <C extends SettingCategory>(
  category: C
) => Partial<AllSystemSettings[C]>;

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