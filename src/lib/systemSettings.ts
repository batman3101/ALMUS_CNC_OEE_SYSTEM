// 시스템 설정 API 및 서비스 레이어

import { supabase } from './supabase';
import type {
  SystemSetting,
  SystemSettingAudit,
  SettingUpdate,
  SettingCategory,
  SettingsResponse,
  SettingUpdateResponse,
  SettingsAuditResponse,
  AllSystemSettings,
  SettingDefinition,
  SettingValidationRule
} from '@/types/systemSettings';

/**
 * 시스템 설정 서비스 클래스
 */
export class SystemSettingsService {
  private static instance: SystemSettingsService;
  private settingsCache: Map<string, any> = new Map();
  private lastCacheUpdate: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5분

  static getInstance(): SystemSettingsService {
    if (!SystemSettingsService.instance) {
      SystemSettingsService.instance = new SystemSettingsService();
    }
    return SystemSettingsService.instance;
  }

  /**
   * 모든 활성 설정 조회
   */
  async getAllSettings(): Promise<SettingsResponse> {
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .eq('is_active', true)
        .order('category, setting_key');

      if (error) {
        console.error('Error fetching system settings:', error);
        return { success: false, error: error.message };
      }

      // 캐시 업데이트
      this.updateCache(data || []);

      return { success: true, data: data || [] };
    } catch (error) {
      console.error('Error in getAllSettings:', error);
      return { success: false, error: 'Failed to fetch system settings' };
    }
  }

  /**
   * 카테고리별 설정 조회
   */
  async getSettingsByCategory(category: SettingCategory): Promise<SettingsResponse> {
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .eq('category', category)
        .eq('is_active', true)
        .order('setting_key');

      if (error) {
        console.error(`Error fetching settings for category ${category}:`, error);
        return { success: false, error: error.message };
      }

      return { success: true, data: data || [] };
    } catch (error) {
      console.error('Error in getSettingsByCategory:', error);
      return { success: false, error: `Failed to fetch settings for category ${category}` };
    }
  }

  /**
   * 특정 설정값 조회
   */
  async getSetting(category: SettingCategory, key: string): Promise<any> {
    try {
      // 캐시에서 먼저 확인
      const cacheKey = `${category}.${key}`;
      if (this.isCacheValid() && this.settingsCache.has(cacheKey)) {
        return this.settingsCache.get(cacheKey);
      }

      const { data, error } = await supabase
        .rpc('get_system_setting', {
          p_category: category,
          p_key: key
        });

      if (error) {
        console.error(`Error fetching setting ${category}.${key}:`, error);
        return null;
      }

      // 캐시에 저장
      this.settingsCache.set(cacheKey, data);

      return data;
    } catch (error) {
      console.error('Error in getSetting:', error);
      return null;
    }
  }

  /**
   * 설정값 업데이트
   */
  async updateSetting(update: SettingUpdate): Promise<SettingUpdateResponse> {
    try {
      // 설정값 검증
      const validationResult = this.validateSettingValue(update);
      if (!validationResult.isValid) {
        return { success: false, error: validationResult.error };
      }

      const { data, error } = await supabase
        .rpc('update_system_setting', {
          p_category: update.category,
          p_key: update.setting_key,
          p_value: JSON.stringify(update.setting_value),
          p_reason: update.change_reason
        });

      if (error) {
        console.error('Error updating system setting:', error);
        return { success: false, error: error.message };
      }

      // 캐시 무효화
      this.invalidateCache();

      // 실시간 브로드캐스트
      await this.broadcastSettingChange(update);

      return { success: true };
    } catch (error) {
      console.error('Error in updateSetting:', error);
      return { success: false, error: 'Failed to update system setting' };
    }
  }

  /**
   * 여러 설정값 일괄 업데이트
   */
  async updateMultipleSettings(updates: SettingUpdate[]): Promise<SettingUpdateResponse> {
    try {
      const results = await Promise.all(
        updates.map(update => this.updateSetting(update))
      );

      const failedUpdates = results.filter(result => !result.success);
      if (failedUpdates.length > 0) {
        return {
          success: false,
          error: `Failed to update ${failedUpdates.length} settings`
        };
      }

      return { success: true };
    } catch (error) {
      console.error('Error in updateMultipleSettings:', error);
      return { success: false, error: 'Failed to update multiple settings' };
    }
  }

  /**
   * 설정 변경 이력 조회
   */
  async getSettingsAudit(limit: number = 50): Promise<SettingsAuditResponse> {
    try {
      const { data, error } = await supabase
        .from('recent_settings_changes')
        .select('*')
        .limit(limit);

      if (error) {
        console.error('Error fetching settings audit:', error);
        return { success: false, error: error.message };
      }

      return { success: true, data: data || [] };
    } catch (error) {
      console.error('Error in getSettingsAudit:', error);
      return { success: false, error: 'Failed to fetch settings audit' };
    }
  }

  /**
   * 구조화된 설정 객체 반환
   */
  async getStructuredSettings(): Promise<Partial<AllSystemSettings>> {
    try {
      const response = await this.getAllSettings();
      if (!response.success || !response.data) {
        return {};
      }

      const structured: Partial<AllSystemSettings> = {};

      response.data.forEach((setting: SystemSetting) => {
        if (!structured[setting.category]) {
          structured[setting.category] = {};
        }
        
        // JSON 값 파싱
        let value = setting.setting_value;
        if (typeof value === 'string') {
          try {
            value = JSON.parse(value);
          } catch {
            // JSON이 아닌 경우 그대로 사용
          }
        }

        structured[setting.category][setting.setting_key] = value;
      });

      return structured;
    } catch (error) {
      console.error('Error in getStructuredSettings:', error);
      return {};
    }
  }

  /**
   * 기본 설정값으로 초기화
   */
  async resetToDefaults(category?: SettingCategory): Promise<SettingUpdateResponse> {
    try {
      const defaultSettings = this.getDefaultSettings();
      const settingsToReset = category 
        ? defaultSettings.filter(s => s.category === category)
        : defaultSettings;

      const updates: SettingUpdate[] = settingsToReset.map(setting => ({
        category: setting.category,
        setting_key: setting.key,
        setting_value: setting.default_value,
        change_reason: `Reset to default value`
      }));

      return await this.updateMultipleSettings(updates);
    } catch (error) {
      console.error('Error in resetToDefaults:', error);
      return { success: false, error: 'Failed to reset settings to defaults' };
    }
  }

  /**
   * 설정값 검증
   */
  private validateSettingValue(update: SettingUpdate): { isValid: boolean; error?: string } {
    const definition = this.getSettingDefinition(update.category, update.setting_key);
    if (!definition) {
      return { isValid: false, error: 'Unknown setting key' };
    }

    const { value_type, validation } = definition;
    const { setting_value } = update;

    // 타입 검증
    if (!this.validateValueType(setting_value, value_type)) {
      return { isValid: false, error: `Invalid value type. Expected ${value_type}` };
    }

    // 추가 검증 규칙
    if (validation) {
      if (validation.required && (setting_value === null || setting_value === undefined || setting_value === '')) {
        return { isValid: false, error: 'This setting is required' };
      }

      if (typeof setting_value === 'number') {
        if (validation.min !== undefined && setting_value < validation.min) {
          return { isValid: false, error: `Value must be at least ${validation.min}` };
        }
        if (validation.max !== undefined && setting_value > validation.max) {
          return { isValid: false, error: `Value must be at most ${validation.max}` };
        }
      }

      if (typeof setting_value === 'string' && validation.pattern) {
        if (!validation.pattern.test(setting_value)) {
          return { isValid: false, error: 'Invalid format' };
        }
      }

      if (validation.validator) {
        const result = validation.validator(setting_value);
        if (result !== true) {
          return { isValid: false, error: typeof result === 'string' ? result : 'Invalid value' };
        }
      }
    }

    return { isValid: true };
  }

  /**
   * 값 타입 검증
   */
  private validateValueType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'time':
        return typeof value === 'string' && /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value);
      case 'color':
        return typeof value === 'string' && /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(value);
      case 'json':
        return true; // JSON은 모든 타입 허용
      default:
        return false;
    }
  }

  /**
   * 캐시 관리
   */
  private updateCache(settings: SystemSetting[]): void {
    this.settingsCache.clear();
    settings.forEach(setting => {
      const cacheKey = `${setting.category}.${setting.setting_key}`;
      let value = setting.setting_value;
      
      // JSON 문자열인 경우 파싱
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          // JSON이 아닌 경우 그대로 사용
        }
      }
      
      this.settingsCache.set(cacheKey, value);
    });
    this.lastCacheUpdate = Date.now();
  }

  private isCacheValid(): boolean {
    return Date.now() - this.lastCacheUpdate < this.CACHE_TTL;
  }

  private invalidateCache(): void {
    this.settingsCache.clear();
    this.lastCacheUpdate = 0;
  }

  /**
   * 실시간 브로드캐스트
   */
  private async broadcastSettingChange(update: SettingUpdate): Promise<void> {
    try {
      // Supabase Realtime을 통한 브로드캐스트
      const channel = supabase.channel('system_settings_changes');
      await channel.send({
        type: 'broadcast',
        event: 'setting_changed',
        payload: {
          category: update.category,
          key: update.setting_key,
          value: update.setting_value,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error broadcasting setting change:', error);
    }
  }

  /**
   * 설정 정의 조회
   */
  private getSettingDefinition(category: SettingCategory, key: string): SettingDefinition | null {
    const definitions = this.getDefaultSettings();
    return definitions.find(def => def.category === category && def.key === key) || null;
  }

  /**
   * 기본 설정 정의
   */
  private getDefaultSettings(): SettingDefinition[] {
    return [
      // 일반 설정
      {
        key: 'company_name',
        category: 'general',
        value_type: 'string',
        default_value: 'CNC Manufacturing Co.',
        description: '회사명',
        is_system: true,
        validation: { required: true }
      },
      {
        key: 'company_logo_url',
        category: 'general',
        value_type: 'string',
        default_value: '',
        description: '회사 로고 URL',
        is_system: false
      },
      {
        key: 'timezone',
        category: 'general',
        value_type: 'string',
        default_value: 'Asia/Seoul',
        description: '시간대 설정',
        is_system: true,
        options: [
          { label: '서울 (Asia/Seoul)', value: 'Asia/Seoul' },
          { label: '호치민 (Asia/Ho_Chi_Minh)', value: 'Asia/Ho_Chi_Minh' },
          { label: 'UTC', value: 'UTC' }
        ]
      },
      {
        key: 'language',
        category: 'general',
        value_type: 'string',
        default_value: 'ko',
        description: '기본 언어',
        is_system: true,
        options: [
          { label: '한국어', value: 'ko' },
          { label: 'Tiếng Việt', value: 'vi' }
        ]
      },

      // OEE 설정
      {
        key: 'target_oee',
        category: 'oee',
        value_type: 'number',
        default_value: 0.85,
        description: 'OEE 목표값',
        is_system: true,
        validation: { required: true, min: 0, max: 1 }
      },
      {
        key: 'target_availability',
        category: 'oee',
        value_type: 'number',
        default_value: 0.90,
        description: '가동률 목표값',
        is_system: true,
        validation: { required: true, min: 0, max: 1 }
      },
      {
        key: 'target_performance',
        category: 'oee',
        value_type: 'number',
        default_value: 0.95,
        description: '성능 목표값',
        is_system: true,
        validation: { required: true, min: 0, max: 1 }
      },
      {
        key: 'target_quality',
        category: 'oee',
        value_type: 'number',
        default_value: 0.99,
        description: '품질 목표값',
        is_system: true,
        validation: { required: true, min: 0, max: 1 }
      },
      {
        key: 'low_oee_threshold',
        category: 'oee',
        value_type: 'number',
        default_value: 0.60,
        description: 'OEE 저하 임계값',
        is_system: true,
        validation: { required: true, min: 0, max: 1 }
      },
      {
        key: 'critical_oee_threshold',
        category: 'oee',
        value_type: 'number',
        default_value: 0.40,
        description: 'OEE 위험 임계값',
        is_system: true,
        validation: { required: true, min: 0, max: 1 }
      },
      {
        key: 'downtime_alert_minutes',
        category: 'oee',
        value_type: 'number',
        default_value: 30,
        description: '다운타임 알림 기준 (분)',
        is_system: true,
        validation: { required: true, min: 1, max: 480 }
      },

      // 교대 설정
      {
        key: 'shift_a_start',
        category: 'shift',
        value_type: 'time',
        default_value: '08:00',
        description: 'A교대 시작 시간',
        is_system: true,
        validation: { required: true }
      },
      {
        key: 'shift_a_end',
        category: 'shift',
        value_type: 'time',
        default_value: '20:00',
        description: 'A교대 종료 시간',
        is_system: true,
        validation: { required: true }
      },
      {
        key: 'shift_b_start',
        category: 'shift',
        value_type: 'time',
        default_value: '20:00',
        description: 'B교대 시작 시간',
        is_system: true,
        validation: { required: true }
      },
      {
        key: 'shift_b_end',
        category: 'shift',
        value_type: 'time',
        default_value: '08:00',
        description: 'B교대 종료 시간',
        is_system: true,
        validation: { required: true }
      },
      {
        key: 'break_time_minutes',
        category: 'shift',
        value_type: 'number',
        default_value: 60,
        description: '교대별 휴식 시간 (분)',
        is_system: true,
        validation: { required: true, min: 0, max: 240 }
      },

      // 알림 설정
      {
        key: 'email_notifications_enabled',
        category: 'notification',
        value_type: 'boolean',
        default_value: true,
        description: '이메일 알림 활성화',
        is_system: false
      },
      {
        key: 'browser_notifications_enabled',
        category: 'notification',
        value_type: 'boolean',
        default_value: true,
        description: '브라우저 알림 활성화',
        is_system: false
      },
      {
        key: 'sound_notifications_enabled',
        category: 'notification',
        value_type: 'boolean',
        default_value: true,
        description: '소리 알림 활성화',
        is_system: false
      },
      {
        key: 'alert_check_interval_seconds',
        category: 'notification',
        value_type: 'number',
        default_value: 60,
        description: '알림 확인 간격 (초)',
        is_system: true,
        validation: { required: true, min: 10, max: 300 }
      },

      // 화면 설정
      {
        key: 'theme_primary_color',
        category: 'display',
        value_type: 'color',
        default_value: '#1890ff',
        description: '주요 테마 색상',
        is_system: false
      },
      {
        key: 'theme_success_color',
        category: 'display',
        value_type: 'color',
        default_value: '#52c41a',
        description: '성공 색상',
        is_system: false
      },
      {
        key: 'theme_warning_color',
        category: 'display',
        value_type: 'color',
        default_value: '#faad14',
        description: '경고 색상',
        is_system: false
      },
      {
        key: 'theme_error_color',
        category: 'display',
        value_type: 'color',
        default_value: '#ff4d4f',
        description: '오류 색상',
        is_system: false
      },
      {
        key: 'dashboard_refresh_interval_seconds',
        category: 'display',
        value_type: 'number',
        default_value: 30,
        description: '대시보드 새로고침 간격 (초)',
        is_system: true,
        validation: { required: true, min: 5, max: 300 }
      },
      {
        key: 'chart_animation_enabled',
        category: 'display',
        value_type: 'boolean',
        default_value: true,
        description: '차트 애니메이션 활성화',
        is_system: false
      },
      {
        key: 'compact_mode',
        category: 'display',
        value_type: 'boolean',
        default_value: false,
        description: '컴팩트 모드',
        is_system: false
      },
      {
        key: 'show_machine_images',
        category: 'display',
        value_type: 'boolean',
        default_value: true,
        description: '설비 이미지 표시',
        is_system: false
      }
    ];
  }
}

// 싱글톤 인스턴스 내보내기
export const systemSettingsService = SystemSettingsService.getInstance();