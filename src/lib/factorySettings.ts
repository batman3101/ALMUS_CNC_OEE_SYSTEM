import { supabaseAdmin } from '@/lib/supabase-admin';
import type { AllSystemSettings, SettingCategory, SystemSetting } from '@/types/systemSettings';

/**
 * 공장 범위 설정 읽기·쓰기 (서버 전용).
 *
 * ## 왜 systemSettingsService 를 쓰지 않는가
 *
 * `systemSettingsService` 는 **브라우저용** 모듈이다. anon 클라이언트로 읽고 RLS 가 공장을
 * 좁혀 준다. 그런데 그 안에는 서버에서 실행되는 분기가 하나 숨어 있었다:
 *
 *   getAllSettings()
 *     -> anon 조회 (서버에서는 세션이 없으니 RLS 가 0행)
 *     -> "데이터 없음" 으로 판단
 *     -> Service Role 로 재조회 (공장 조건 없음)  ← 두 공장 설정이 합쳐진다
 *     -> 그 결과를 모듈 레벨 캐시에 넣는다        ← 요청 사이로 오염이 번진다
 *
 * 즉 서버에서 그 함수를 부르면 **반드시** 공장 경계를 넘는다. 우연이 아니라 구조다 —
 * 서버에는 세션이 없으므로 RLS 경로가 항상 0행을 주고, 항상 우회 분기로 떨어진다.
 *
 * 그래서 서버 경로는 그 모듈을 거치지 않고 여기서 **공장을 명시적으로 받아** 처리한다.
 * 인자가 필수인 것이 요점이다 — 선택적이면 빠뜨려도 조용히 통과하고, 그것이 없애려는
 * 실패 그 자체다.
 */

/**
 * 저장 형태(`{value: ...}`)를 화면이 쓰는 평평한 형태로 편다.
 *
 * `systemSettingsService.getStructuredSettings` 의 변환 규칙과 **같아야 한다.** 두 곳이
 * 갈라지면 같은 설정이 어느 경로로 읽었는지에 따라 다른 값으로 보인다.
 */
export function structureSettings(rows: readonly SystemSetting[]): Partial<AllSystemSettings> {
  const structured: Record<string, Record<string, unknown>> = {};

  for (const setting of rows) {
    if (!structured[setting.category]) structured[setting.category] = {};

    let value: unknown = setting.setting_value;

    // DB 는 항상 {value: 실제값} 으로 감싸 저장한다.
    if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
      value = (value as Record<string, unknown>).value;
    }

    // 복합 값(배열·객체)은 문자열로 저장되어 있을 수 있다. 파싱에 실패하면 **문자열 그대로**
    // 둔다 — 못 읽은 값을 null 로 바꾸면 "설정이 없다"와 구분이 사라진다.
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        // 문자열이 곧 값이다.
      }
    }

    structured[setting.category][setting.setting_key] = value;
  }

  return structured as Partial<AllSystemSettings>;
}

/** 이 공장의 활성 설정 전부. */
export async function readFactorySettings(factoryId: string): Promise<SystemSetting[]> {
  const { data, error } = await supabaseAdmin
    .from('system_settings')
    .select('*')
    .eq('factory_id', factoryId)
    .eq('is_active', true)
    .order('category, setting_key');

  // 조회 실패를 빈 배열로 뭉개지 않는다. "설정이 없다"와 "읽지 못했다"는 다르고, 후자를
  // 전자로 취급하면 기본값으로 계산한 결과가 정상처럼 보인다.
  if (error) {
    throw new Error(`설정을 조회하지 못했습니다: ${error.message}`);
  }

  return (data ?? []) as SystemSetting[];
}

export interface FactorySettingWrite {
  category: SettingCategory;
  setting_key: string;
  setting_value: unknown;
}

/**
 * 이 공장의 설정을 **한 트랜잭션**으로 저장한다.
 *
 * 값 인코딩은 `/api/system-settings/update` 와 같은 규칙을 쓴다 — RPC 가 text 를 받아 종류를
 * 스스로 판별하므로, 경로마다 인코딩이 다르면 같은 값이 경로에 따라 다르게 저장된다.
 */
export async function writeFactorySettings(
  factoryId: string,
  userId: string,
  updates: readonly FactorySettingWrite[],
  changeReason: string | null,
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin.rpc('update_system_settings_batch_scoped', {
    p_factory_id: factoryId,
    p_updates: updates.map(u => ({
      category: u.category,
      setting_key: u.setting_key,
      setting_value: typeof u.setting_value === 'string'
        ? u.setting_value
        : JSON.stringify(u.setting_value),
    })),
    p_reason: changeReason,
    p_changed_by: userId,
  });

  // 이 RPC 는 실패를 예외가 아니라 `{ok:false, reason}` 으로도 돌려준다. `error` 만 보면
  // "성공했는데 아무것도 안 바뀜"을 성공으로 읽는다 — 가장 알아채기 어려운 실패다.
  const result = data as { ok?: boolean; reason?: string; updated?: number } | null;
  if (error || !result?.ok) {
    return { ok: false, error: error?.message ?? result?.reason ?? 'unknown' };
  }
  return { ok: true, updated: result.updated ?? updates.length };
}
