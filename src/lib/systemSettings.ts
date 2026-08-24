// 시스템 설정 API 및 서비스 레이어

import { supabase } from './supabase';
import { log, LogCategories } from './logger';
import { factoryChannelName, getCurrentFactoryScope } from './realtimeScope';
import { SETTINGS_REGISTRY, validateSettingValue as validateAgainstRegistry } from './settingsRegistry';
import type {
  SystemSetting,
  SettingUpdate,
  SettingCategory,
  SettingsResponse,
  SettingUpdateResponse,
  SettingsAuditResponse,
  AllSystemSettings,
  SettingDefinition,
  SettingValueType
} from '@/types/systemSettings';

/**
 * getDefaultSettings() 에서 select 옵션 메타데이터(라벨/값 목록)를 함께 표현하기 위한 로컬 확장 타입.
 * `SettingDefinition` (공유 타입, 읽기 전용) 에는 options 필드가 없으므로 여기서만 확장한다.
 */
type SettingDefinitionWithOptions = SettingDefinition & {
  options?: Array<{ label: string; value: string }>;
};

/**
 * DB 에 저장된 canonical setting_key 와 코드 타입 계약(AllSystemSettings)의 필드명이
 * 다른 경우를 위한 별칭 매핑. 현재는 general.default_language (DB) <-> general.language
 * (AllSystemSettings 타입 계약) 하나뿐이다.
 *
 * 이 매핑은 DB 키가 로컬 설정 state 로 들어오는 "모든" 경계에서 적용되어야 한다.
 * 한 경로에서라도 빠뜨리면 같은 설정이 두 개의 키(default_language / language)로
 * 갈라져 state 에 공존하게 되고, 읽는 쪽은 갱신되지 않은 옛 키를 계속 보게 된다.
 * (실제로 쓰기 경로에서 이 매핑이 빠져 있어 언어 토글이 눌러도 원래 언어로 되돌아갔다:
 *  DB 와 localStorage 에는 새 언어가 저장되는데 화면만 옛 언어로 복귀했다.)
 */
const DB_KEY_ALIASES: Partial<Record<SettingCategory, Record<string, string>>> = {
  general: { default_language: 'language' }
};

export function mapDbKeyToCodeKey(category: SettingCategory, dbKey: string): string {
  return DB_KEY_ALIASES[category]?.[dbKey] ?? dbKey;
}

/** SettingDefinition.value_type -> SystemSetting.data_type 변환 (DB jsonb 컬럼의 논리적 분류가 다르다) */
function mapValueTypeToDataType(valueType: SettingValueType): SystemSetting['data_type'] {
  switch (valueType) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'json':
      return 'object';
    case 'string':
    case 'color':
    case 'time':
    default:
      return 'string';
  }
}

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
        // (이 지점에 도달했다는 것은 위의 error 체크를 통과했다는 뜻이므로 error 는 항상 null)
        log.info('No system settings found in database, using default values', {
          dataLength: data?.length,
          errorDetails: 'No error',
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
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        const response = await fetch('/api/system-settings/service-role', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (response.ok) {
          const result = await response.json();
          return { data: result.data, error: null };
        }
        return { data: null, error: 'Failed to fetch with service role' };
      }
      
      // ── 서버에서는 이 모듈을 쓰지 않는다 ─────────────────────────────────────
      //
      // 여기서 Service Role 클라이언트를 만들면 RLS 를 우회하고, 그 쿼리에는 공장 조건이
      // 없다. 즉 서버에서 이 경로에 들어오는 것 자체가 공장 경계를 넘는 것이다 — 우연이
      // 아니라 구조다(서버에는 세션이 없으므로 위의 RLS 경로는 **항상** 0행을 주고, 항상
      // 여기로 떨어진다).
      //
      // 서버 호출자는 `@/lib/factorySettings` 를 쓴다. 그 모듈은 공장을 **필수 인자**로
      // 받으므로 빠뜨릴 수 없다.
      //
      // 조용히 우회하는 대신 시끄럽게 거부한다. 이 오류가 보이면 서버 코드가 브라우저용
      // 모듈을 부른 것이고, 고칠 곳은 호출자다.
      return {
        data: null,
        error: '서버에서는 systemSettingsService 로 설정을 읽을 수 없습니다. @/lib/factorySettings 를 쓰십시오.',
      };
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
   * 여러 설정을 **한 트랜잭션**으로 저장한다 (적대적 재감사 #9).
   *
   * `updateMultipleSettings` 와 다른 점이 이 메서드의 전부다. 그쪽은
   * `Promise.all(updates.map(updateSetting))` 이라 부분 실패가 그대로 남는다 — 병렬이라
   * 어느 것이 남았는지 예측하기도 어렵다. 서로를 해석하는 값들(교대 시작·휴식·전환 유예)이
   * 반쪽만 반영되면 "설정이 좀 틀린" 게 아니라 **어느 세대의 규칙으로 계산됐는지 알 수 없는**
   * 상태가 되고, 그 상태로 계산된 OEE 는 나중에 되짚을 수도 없다.
   *
   * 실패하면 조용히 일부만 남기지 말고 그대로 실패시킨다. 되돌리기는 DB 트랜잭션이 한다.
   */
  async updateSettingsAtomic(
    updates: SettingUpdate[],
    changeReason?: string,
  ): Promise<SettingUpdateResponse> {
    if (updates.length === 0) return { success: false, error: '저장할 설정이 없습니다.' };

    for (const update of updates) {
      const validation = this.validateSettingValue(update);
      if (!validation.isValid) return { success: false, error: validation.error };
    }

    const result = await this.sendBatch(updates, changeReason);
    if (!result.success) return result;

    // 한 번에 바뀌었으므로 캐시도 한 번만 비운다.
    this.invalidateCache();
    for (const update of updates) await this.broadcastSettingChange(update);
    return { success: true };
  }

  /**
   * 배치 저장의 전송 계층. 브라우저와 서버가 같은 트랜잭션(=같은 RPC)에 도달하게 한다.
   *
   * 두 경로가 필요한 이유는 호출자가 양쪽에 있기 때문이다 — 설정 화면(브라우저)과
   * `/api/system-settings` PUT·`/api/system-settings/[category]` PUT/DELETE(서버). 브라우저에서
   * 상대 경로 fetch 는 되지만 서버에서는 되지 않고, 서버에서 Service Role 클라이언트를 만드는
   * 것은 브라우저에서 하면 안 된다. 갈라지는 것은 **전송 방법뿐**이고 도착지는 하나다.
   *
   * `update_system_settings_batch` 의 EXECUTE 권한은 `service_role` 에만 있다
   * (`20260729220000_settings_batch_update.sql`). 그래서 브라우저 경로는 반드시 라우트를 거친다 —
   * 거기서 관리자 세션을 확인한 뒤 Service Role 로 바꿔 부른다.
   */
  private async sendBatch(
    updates: SettingUpdate[],
    changeReason?: string,
  ): Promise<SettingUpdateResponse> {
    // RPC 는 text 를 받아 값 종류(문자열/숫자/불리언)를 스스로 판별한다. 단건 경로와 같은
    // 규칙을 쓴다 — 인코딩이 경로마다 다르면 같은 값이 경로에 따라 다르게 저장된다.
    const wireUpdates = updates.map(u => ({
      category: u.category,
      setting_key: u.setting_key,
      setting_value: typeof u.setting_value === 'string'
        ? u.setting_value
        : JSON.stringify(u.setting_value),
    }));

    if (typeof window !== 'undefined') {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/system-settings/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ updates: wireUpdates, change_reason: changeReason }),
      });

      const result = (await response.json().catch(() => null)) as
        { success?: boolean; error?: string } | null;
      if (!response.ok || !result?.success) {
        return { success: false, error: result?.error ?? `HTTP ${response.status}` };
      }
      return { success: true };
    }

    // 서버 경로는 `@/lib/factorySettings.writeFactorySettings` 가 담당한다. 여기서
    // Service Role 로 `update_system_settings_batch`(공장 무지 버전)를 부르면 어느 공장
    // 행이 바뀔지 보장이 없다 — plpgsql 의 `SELECT ... INTO` 는 여러 행이 와도 오류 없이
    // 첫 행을 집는다. 조용히 틀리는 것보다 거부가 낫다.
    void wireUpdates;
    void changeReason;
    return {
      success: false,
      error: '서버에서는 systemSettingsService 로 설정을 저장할 수 없습니다. @/lib/factorySettings 를 쓰십시오.',
    };
  }

  /**
   * Service Role을 통한 설정 업데이트 (RLS 우회)
   */
  private async updateSettingViaServiceRole(update: SettingUpdate, valueToSave: string): Promise<SettingUpdateResponse> {
    try {
      // 클라이언트 사이드에서는 API 라우트를 통해 처리.
      // 이 라우트는 Service Role 로 전역 설정을 쓰므로 관리자 세션을 요구한다.
      // 세션 토큰을 실어 보내지 않으면 401 이 되고, 관리자여도 설정을 저장할 수 없다.
      if (typeof window !== 'undefined') {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch('/api/system-settings/update', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token
              ? { Authorization: `Bearer ${session.access_token}` }
              : {}),
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
      
      // 단건도 같다 — 서버 경로는 `@/lib/factorySettings` 를 쓴다.
      void valueToSave;
      return {
        success: false,
        error: '서버에서는 systemSettingsService 로 설정을 저장할 수 없습니다. @/lib/factorySettings 를 쓰십시오.',
      };
    } catch (error) {
      console.error('Service Role 업데이트 중 오류:', error);
      return { success: false, error: `Service Role 처리 중 오류: ${error}` };
    }
  }

  /**
   * 여러 설정값 일괄 업데이트 — `updateSettingsAtomic` 과 같은 한 트랜잭션을 쓴다.
   *
   * 예전 구현은 `Promise.all(updates.map(updateSetting))` 이었다. N번의 독립 요청이므로
   * 중간이 실패하면 앞선 것들은 이미 저장돼 있고, 병렬이라 무엇이 남았는지 예측조차 어렵다.
   * 호출자는 `success: false` 하나만 받고 DB 에는 절반이 남는다 — 화면과 DB 가 다른 이야기를
   * 하는 상태다 (2026-08-06 감사 HIGH-05).
   *
   * 시그니처와 반환 형태는 그대로 둔다. 바뀐 것은 **요청 수가 N 에서 1 로 줄었다는 것**이고,
   * 그것이 이 변경의 전부다. 회귀 검사도 반환값이 아니라 요청 수를 단언한다 — 반환값만 보는
   * 테스트는 깨진 구현에서도 통과한다.
   */
  async updateMultipleSettings(updates: SettingUpdate[]): Promise<SettingUpdateResponse> {
    try {
      // 배치 RPC 는 사유를 하나만 받는다. 개별 사유는 "Updated display X setting" 처럼
      // 키를 되풀이하는 문구뿐이고, 감사 행에는 category·setting_key 가 따로 남으므로
      // 첫 사유를 대표로 쓴다.
      const changeReason = updates.find(u => u.change_reason)?.change_reason;
      return await this.updateSettingsAtomic(updates, changeReason);
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

      const structured: Record<string, Record<string, unknown>> = {};

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

        // DB 의 canonical key 를 코드 타입 계약(AllSystemSettings)의 key 로 매핑
        const codeKey = mapDbKeyToCodeKey(setting.category, setting.setting_key);
        structured[setting.category][codeKey] = value;
      });

      return structured as Partial<AllSystemSettings>;
    } catch (error) {
      console.error('Error in getStructuredSettings:', error);
      return {};
    }
  }

  /**
   * 기본 설정값으로 초기화 — 원장의 기본값을 **한 트랜잭션**으로 다시 기록한다.
   *
   * 이 메서드는 관리자가 "모든 설정 초기화" 버튼으로 부르는 것이고, 그래서 두 가지가 동시에
   * 위험했다 (2026-08-06 감사 HIGH-01):
   *
   * 1. 기본값이 운영값과 어긋나 있었다. 휴식 60분을 써 넣으면 `/api/production-progress` 가
   *    안전 중단해 실시간 지표가 전 설비에서 사라진다. 이제 기본값은 실시간 계산이 쓰는 상수를
   *    그대로 가져온다(`settingsRegistry.ts`).
   * 2. `Promise.all` 로 32번을 따로 썼다. 중간에 실패하면 **일부만 초기화된** 상태가 남는다.
   *    초기화의 존재 이유가 "알 수 없는 상태에서 아는 상태로 되돌리는 것"인데, 부분 실패는
   *    더 알 수 없는 상태를 만든다. 한 트랜잭션이면 전부 되돌아가거나 전부 적용된다.
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

      const result = await this.updateSettingsAtomic(
        definitions.map(def => ({
          category: def.category,
          setting_key: def.key,
          setting_value: def.default_value,
        })),
        'Reset to default value',
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error ?? `Failed to reset ${definitions.length} settings to defaults`
        };
      }

      return { success: true, message: 'Settings reset to defaults successfully' };
    } catch (error) {
      console.error('Error in resetToDefaults:', error);
      return { success: false, error: 'Failed to reset settings to defaults' };
    }
  }

  /**
   * 설정값 검증 — 원장이 기준이다.
   *
   * 예전에는 `null`/`undefined` 만 걸렀고, 자료형을 아는 `validateValueType()` 은 만들어만
   * 두고 **어느 저장 경로에서도 부르지 않았다.** 그래서 오타 키도 잘못된 자료형도 그대로
   * 저장됐고, `update_system_setting` 은 없는 키를 만나면 새 행을 만들기 때문에 그 오타가
   * 영구 레거시 행이 됐다 — 라이브에 그렇게 쌓인 계약 밖 활성 키가 11개다
   * (2026-08-06 감사 5.2). 검증기를 두 벌 두면 언젠가 한쪽만 고쳐지므로 원장 하나만 남긴다.
   */
  private validateSettingValue(update: SettingUpdate): { isValid: boolean; error?: string } {
    const result = validateAgainstRegistry(update.category, update.setting_key, update.setting_value);
    return result.ok ? { isValid: true } : { isValid: false, error: result.error };
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
      // broadcast 는 RLS 를 타지 않는다. 토픽을 공장별로 갈라 두지 않으면 이 저장이
      // 다른 공장 클라이언트를 재조회시킨다(@/lib/realtimeScope).
      const channel = supabase.channel(
        factoryChannelName('system_settings_changes', getCurrentFactoryScope())
      );
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
  private getSettingDefinition(category: SettingCategory, key: string): SettingDefinitionWithOptions | null {
    const definitions = this.getDefaultSettings();
    return definitions.find(def => def.category === category && def.key === key) || null;
  }

  /**
   * 기본 설정 응답 반환 (테이블이 없을 때)
   */
  private getDefaultSettingsResponse(): SettingsResponse {
    const defaultSettings = this.getDefaultSettings();
    const defaultData: SystemSetting[] = defaultSettings.map((setting, index) => ({
      id: `default-${index}`,
      category: setting.category,
      setting_key: setting.key,
      setting_value: setting.default_value,
      default_value: setting.default_value,
      data_type: mapValueTypeToDataType(setting.value_type),
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
   * 기본 설정 정의 — 원장(`settingsRegistry.ts`)의 투영이다.
   *
   * 예전에는 이 자리에 32개짜리 목록이 통째로 적혀 있었고, 그것이 초기화의 유일한 기준이었다.
   * 화면·DB 와 따로 자라다가 2026-08-06 감사에서 실제로 갈라진 채 발견됐다 — 제거된
   * `shift_a_end`/`shift_b_end` 를 되살리고 현행 `shift_change_buffer_minutes`/
   * `notification_email` 은 빠뜨린 상태였다. 목록을 여기에 다시 적지 않는다.
   *
   * 원장은 camelCase, 이 계층의 `SettingDefinition` 은 DB 컬럼을 따라 snake_case 라 이름만
   * 옮긴다. 값은 하나도 만들지 않는다 — 만드는 순간 두 벌이 된다.
   */
  private getDefaultSettings(): SettingDefinitionWithOptions[] {
    return SETTINGS_REGISTRY.map(entry => ({
      key: entry.key,
      category: entry.category,
      value_type: entry.valueType,
      default_value: entry.defaultValue,
      description: entry.description,
      is_system: entry.isSystem,
      ...(entry.validation ? { validation: { ...entry.validation } } : {}),
      ...(entry.options ? { options: entry.options.map(option => ({ ...option })) } : {}),
    }));
  }

}

// 싱글톤 인스턴스 내보내기
export const systemSettingsService = SystemSettingsService.getInstance();
