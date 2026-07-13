// 시스템 설정 API 및 서비스 레이어

import { supabase } from './supabase';
import { log, LogCategories } from './logger';
import type {
  SystemSetting,
  SettingUpdate,
  SettingCategory,
  SettingsResponse,
  SettingUpdateResponse,
  SettingsAuditResponse,
  AllSystemSettings
} from '@/types/systemSettings';

/**
 * 시스템 설정 서비스 클래스
 */
export class SystemSettingsService {
  private static instance: SystemSettingsService;
  private settingsCache: Map<string, unknown> = new Map();
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
      // 테이블 존재 여부 확인
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .eq('is_active', true)
        .order('category, setting_key');

      if (error) {
        log.error('Error fetching system settings', error, LogCategories.SETTINGS);
        
        // 테이블이 존재하지 않는 경우 기본값 반환
        if (error.code === 'PGRST116' || error.message.includes('relation') || error.message.includes('does not exist')) {
          log.warn('System settings table does not exist, using default values', { errorCode: error.code }, LogCategories.SETTINGS);
          return this.getDefaultSettingsResponse();
        }
        
        return { success: false, error: error.message };
      }

      // 데이터가 없는 경우
      if (!data || data.length === 0) {
        // Service Role을 사용해서 다시 시도 (RLS 우회)
        try {
          console.log('📋 No settings found with regular client, trying with service role...');

          const { data: serviceData } = await this.getSettingsWithServiceRole();
          
          if (serviceData && serviceData.length > 0) {
            console.log('✅ Settings retrieved with service role:', serviceData.length);
            this.updateCache(serviceData);
            return { success: true, data: serviceData };
          }
        } catch (serviceRoleError) {
          console.warn('⚠️ Service role fetch failed:', serviceRoleError);
        }
        
        // 정말로 데이터가 없는 경우에만 기본값 반환
        log.info('No system settings found in database, using default values', { 
          dataLength: data?.length,
          errorDetails: error ? error.message : 'No error',
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 20) + '...'
        }, LogCategories.SETTINGS);
        
        return this.getDefaultSettingsResponse();
      }

      // 캐시 업데이트
      this.updateCache(data);

      return { success: true, data };
    } catch (error) {
      log.error('Error in getAllSettings', error, LogCategories.SETTINGS);
      return this.getDefaultSettingsResponse();
    }
  }

  /**
   * Service Role을 사용하여 설정 조회 (RLS 우회)
   */
  private async getSettingsWithServiceRole(): Promise<{ data: SystemSetting[] | null; error: unknown }> {
    try {
      // 서버 사이드에서만 실행 가능
      if (typeof window !== 'undefined') {
        // 클라이언트 사이드에서는 API 라우트를 통해 조회
        const response = await fetch('/api/system-settings/service-role');
        if (response.ok) {
          const result = await response.json();
          return { data: result.data, error: null };
        }
        return { data: null, error: 'Failed to fetch with service role' };
      }
      
      // 서버 사이드에서는 직접 Service Role 사용
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceRoleKey) {
        return { data: null, error: 'Service role key not available' };
      }
      
      const { createClient } = await import('@supabase/supabase-js');
      const serviceClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      );
      
      return await serviceClient
        .from('system_settings')
        .select('*')
        .eq('is_active', true)
        .order('category, setting_key');
    } catch (error) {
      console.error('Error in getSettingsWithServiceRole:', error);
      return { data: null, error };
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
        log.error('Error fetching settings for category', error, LogCategories.SETTINGS);
        return { success: false, error: error.message };
      }

      return { success: true, data: data || [] };
    } catch (error) {
      log.error('Error in getSettingsByCategory', error, LogCategories.SETTINGS);
      return { success: false, error: `Failed to fetch settings for category ${category}` };
    }
  }

  /**
   * 특정 설정값 조회
   */
  async getSetting(category: SettingCategory, key: string): Promise<unknown> {
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
   * 설정값 업데이트 (Service Role 우회 로직 포함)
   */
  async updateSetting(update: SettingUpdate): Promise<SettingUpdateResponse> {
    try {
      // 설정값 검증
      const validationResult = this.validateSettingValue(update);
      if (!validationResult.isValid) {
        return { success: false, error: validationResult.error };
      }

      // Prepare value for database - convert to string for RPC function
      let valueToSave: string;
      if (typeof update.setting_value === 'string') {
        valueToSave = update.setting_value;
      } else {
        valueToSave = JSON.stringify(update.setting_value);
      }

      console.log('🔧 시스템 설정 업데이트 시도:', {
        category: update.category,
        key: update.setting_key,
        value: valueToSave,
        reason: update.change_reason
      });

      // 1차 시도: 일반 클라이언트 RPC 호출
      const { error } = await supabase
        .rpc('update_system_setting', {
          p_category: update.category,
          p_key: update.setting_key,
          p_value: valueToSave,
          p_reason: update.change_reason
        });

      if (error) {
        console.warn('⚠️ 일반 클라이언트 RPC 호출 실패:', error);

        // 2차 시도: Service Role API를 통한 우회 처리
        try {
          console.log('🔄 Service Role API를 통한 우회 시도...');
          
          const serviceRoleResponse = await this.updateSettingViaServiceRole(update, valueToSave);
          
          if (serviceRoleResponse.success) {
            console.log('✅ Service Role을 통한 설정 업데이트 성공');
            
            // 캐시 무효화 및 브로드캐스트
            this.invalidateCache();
            await this.broadcastSettingChange(update);
            
            // Log successful update
            log.info('시스템 설정이 Service Role을 통해 성공적으로 업데이트됨', {
              category: update.category,
              key: update.setting_key,
              value: update.setting_value,
              method: 'service_role'
            }, LogCategories.SETTINGS);
            
            return { success: true };
          } else {
            console.error('❌ Service Role 업데이트도 실패:', serviceRoleResponse.error);
            return { 
              success: false, 
              error: `설정 업데이트 실패: ${serviceRoleResponse.error || '알 수 없는 오류'}`
            };
          }
        } catch (serviceRoleError) {
          console.error('❌ Service Role 우회 처리 중 예외 발생:', serviceRoleError);
          return { 
            success: false, 
            error: `시스템 설정 업데이트에 실패했습니다. 관리자에게 문의하세요. (오류: ${error.message})`
          };
        }
      }

      // 1차 시도 성공
      console.log('✅ 일반 클라이언트 RPC 호출 성공');
      
      // Log successful update
      log.info('시스템 설정이 성공적으로 업데이트됨', {
        category: update.category,
        key: update.setting_key,
        value: update.setting_value,
        method: 'regular_client'
      }, LogCategories.SETTINGS);

      // 캐시 무효화
      this.invalidateCache();

      // 실시간 브로드캐스트
      await this.broadcastSettingChange(update);

      return { success: true };
    } catch (error) {
      console.error('❌ updateSetting에서 예외 발생:', error);
      return { 
        success: false, 
        error: '시스템 설정 업데이트 중 오류가 발생했습니다. 다시 시도해 주세요.'
      };
    }
  }

  /**
   * Service Role을 통한 설정 업데이트 (RLS 우회)
   */
  private async updateSettingViaServiceRole(update: SettingUpdate, valueToSave: string): Promise<SettingUpdateResponse> {
    try {
      // 클라이언트 사이드에서는 API 라우트를 통해 처리
      if (typeof window !== 'undefined') {
        const response = await fetch('/api/system-settings/update', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            category: update.category,
            setting_key: update.setting_key,
            setting_value: valueToSave,
            change_reason: update.change_reason
          })
        });

        if (response.ok) {
          const result = await response.json();
          return result;
        } else {
          const errorResult = await response.json();
          return { 
            success: false, 
            error: errorResult.error || `HTTP ${response.status}: ${response.statusText}`
          };
        }
      }
      
      // 서버 사이드에서는 직접 Service Role 사용
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceRoleKey) {
        return { success: false, error: 'Service Role Key를 사용할 수 없습니다' };
      }
      
      const { createClient } = await import('@supabase/supabase-js');
      const serviceClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      );
      
      const { error: rpcError } = await serviceClient
        .rpc('update_system_setting', {
          p_category: update.category,
          p_key: update.setting_key,
          p_value: valueToSave,
          p_reason: update.change_reason
        });

      if (rpcError) {
        console.error('Service Role RPC 호출 실패:', rpcError);
        return { success: false, error: rpcError.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Service Role 업데이트 중 오류:', error);
      return { success: false, error: `Service Role 처리 중 오류: ${error}` };
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
        
        // Extract value from the database structure
        let value = setting.setting_value;
        
        // Handle the database structure {value: actual_value}
        if (value && typeof value === 'object' && 'value' in value) {
          value = value.value;
        }
        
        // Additional JSON parsing if needed
        if (typeof value === 'string') {
          try {
            // Try to parse as JSON for complex values
            if (value.startsWith('{') || value.startsWith('[') || value.startsWith('"')) {
              value = JSON.parse(value);
            }
          } catch {
            // Keep as string if not valid JSON
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
   * (감사 추적이 남는 update_system_setting RPC를 통해 기본값을 다시 기록한다)
   */
  async resetToDefaults(category?: SettingCategory): Promise<SettingUpdateResponse> {
    try {
      const definitions = this.getDefaultSettings().filter(
        def => !category || def.category === category
      );

      if (definitions.length === 0) {
        return {
          success: false,
          error: `No default settings found${category ? ` for category ${category}` : ''}`
        };
      }

      const results = await Promise.all(
        definitions.map(def => this.updateSetting({
          category: def.category,
          setting_key: def.key,
          setting_value: def.default_value,
          change_reason: 'Reset to default value'
        }))
      );

      const failedResets = results.filter(result => !result.success);
      if (failedResets.length > 0) {
        return {
          success: false,
          error: `Failed to reset ${failedResets.length} of ${definitions.length} settings to defaults`
        };
      }

      return { success: true, message: 'Settings reset to defaults successfully' };
    } catch (error) {
      console.error('Error in resetToDefaults:', error);
      return { success: false, error: 'Failed to reset settings to defaults' };
    }
  }

  /**
   * 설정값 검증 (간단한 버전)
   */
  private validateSettingValue(update: SettingUpdate): { isValid: boolean; error?: string } {
    // 기본적인 검증만 수행
    if (update.setting_value === null || update.setting_value === undefined) {
      return { isValid: false, error: 'Setting value cannot be null or undefined' };
    }

    return { isValid: true };
  }


  /**
   * 값 타입 검증
   */
  private validateValueType(value: unknown, expectedType: string): boolean {
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
      
      // Handle the database structure {value: actual_value}
      if (value && typeof value === 'object' && 'value' in value) {
        value = value.value;
      }
      
      // JSON 문자열인 경우 파싱
      if (typeof value === 'string') {
        try {
          // Try to parse as JSON for complex values
          if (value.startsWith('{') || value.startsWith('[') || value.startsWith('"')) {
            value = JSON.parse(value);
          }
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
   * 기본 설정 응답 반환 (테이블이 없을 때)
   */
  private getDefaultSettingsResponse(): SettingsResponse {
    const defaultSettings = this.getDefaultSettings();
    const defaultData = defaultSettings.map((setting, index) => ({
      id: `default-${index}`,
      category: setting.category,
      setting_key: setting.key,
      setting_value: setting.default_value,
      value_type: setting.value_type,
      description: setting.description,
      is_system: setting.is_system,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    // 캐시 업데이트
    this.updateCache(defaultData);

    return { success: true, data: defaultData };
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
        default_value: 'ALMUS TECH',
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
        default_value: 'Asia/Ho_Chi_Minh',
        description: '시간대 설정',
        is_system: true,
        options: [
          { label: '서울 (Asia/Seoul)', value: 'Asia/Seoul' },
          { label: '호치민 (Asia/Ho_Chi_Minh)', value: 'Asia/Ho_Chi_Minh' },
          { label: 'UTC', value: 'UTC' }
        ]
      },
      {
        key: 'date_format',
        category: 'general',
        value_type: 'string',
        default_value: 'DD/MM/YYYY',
        description: '날짜 형식',
        is_system: true,
        options: [
          { label: 'DD/MM/YYYY', value: 'DD/MM/YYYY' },
          { label: 'MM/DD/YYYY', value: 'MM/DD/YYYY' },
          { label: 'YYYY-MM-DD', value: 'YYYY-MM-DD' },
          { label: 'YYYY/MM/DD', value: 'YYYY/MM/DD' }
        ]
      },
      {
        key: 'time_format',
        category: 'general',
        value_type: 'string',
        default_value: 'HH:mm:ss',
        description: '시간 형식',
        is_system: true,
        options: [
          { label: '24시간 (HH:mm:ss)', value: 'HH:mm:ss' },
          { label: '24시간 (HH:mm)', value: 'HH:mm' },
          { label: '12시간 (hh:mm:ss A)', value: 'hh:mm:ss A' },
          { label: '12시간 (hh:mm A)', value: 'hh:mm A' }
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
        key: 'theme_mode',
        category: 'display',
        value_type: 'string',
        default_value: 'light',
        description: '테마 모드',
        is_system: false,
        options: [
          { label: '라이트 모드', value: 'light' },
          { label: '다크 모드', value: 'dark' }
        ]
      },
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
      },
      {
        key: 'sidebar_collapsed',
        category: 'display',
        value_type: 'boolean',
        default_value: false,
        description: '사이드바 접힘 상태',
        is_system: false
      }
    ];
  }

}

// 싱글톤 인스턴스 내보내기
export const systemSettingsService = SystemSettingsService.getInstance();