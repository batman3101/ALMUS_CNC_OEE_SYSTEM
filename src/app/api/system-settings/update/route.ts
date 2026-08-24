import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateSettingValue } from '@/lib/settingsRegistry';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';

/**
 * Service Role을 사용하여 시스템 설정 업데이트 (RLS 우회)
 * POST /api/system-settings/update
 *
 * ⚠️ 이 라우트는 Service Role 키로 전역 system_settings 를 쓴다. 즉 RLS 를 우회한다.
 *    예전에는 인증/인가 검사가 전혀 없어서, 로그인하지 않은 사람도 POST 한 번으로
 *    교대 시간·OEE 임계값·회사명 등 모든 전역 설정을 덮어쓸 수 있었다.
 *    DB 의 update_system_setting 을 관리자 전용으로 막아도 이 경로가 열려 있으면 의미가 없으므로,
 *    여기서도 반드시 "관리자 세션"임을 확인한 뒤에만 Service Role 을 사용한다.
 */
interface SettingUpdateItem {
  category: string;
  setting_key: string;
  setting_value: unknown;
}

/** 배치 요청의 항목들을 형태만 보고 정규화한다. 하나라도 어긋나면 전체를 거부한다. */
function normalizeUpdates(raw: unknown): SettingUpdateItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items: SettingUpdateItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { category, setting_key, setting_value } = entry as Record<string, unknown>;
    if (typeof category !== 'string' || !category) return null;
    if (typeof setting_key !== 'string' || !setting_key) return null;
    items.push({ category, setting_key, setting_value });
  }
  return items;
}

/**
 * 현행 설정 계약(`src/lib/settingsRegistry.ts`)과 대조한다. 어긋난 첫 항목의 사유를 돌려주고,
 * 모두 통과하면 `null` 을 돌려준다.
 *
 * ## 왜 여기서 막아야 하나
 *
 * 이 라우트가 부르는 `update_system_setting` 은 **키가 없으면 새 행을 INSERT 한다**
 * (`supabase/migrations/20260714040000_role_based_rls.sql`). 즉 오타 한 번, 옛 코드 경로 한 번이
 * 곧바로 영구 레거시 행이 되고, 아무도 오류를 보지 못한다 — 응답은 성공이기 때문이다.
 * 라이브 DB 에 현행 32개 계약 밖의 활성 키가 11개 쌓인 경로가 정확히 이것이다
 * (`display.theme`, `oee.quality_target`, `ui.language`, ... — 2026-08-06 감사 5.2).
 * 예전 검사는 카테고리·키가 빈 문자열인지만 봤고 자료형도 범위도 보지 않았다.
 *
 * ## 왜 인가 뒤인가
 *
 * 계약 위반 사유는 "어떤 키가 존재하는가"를 알려준다. 인가 앞에서 검사하면 로그인하지 않은
 * 사람이 400/401 차이만으로 설정 키 목록을 훑을 수 있다. 형태 검사(카테고리·키가 문자열인가)는
 * 그런 정보를 담지 않으므로 예전 위치에 그대로 둔다.
 */
function contractViolation(items: readonly SettingUpdateItem[]): string | null {
  for (const item of items) {
    const result = validateSettingValue(item.category, item.setting_key, item.setting_value);
    if (!result.ok) return result.error;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const category = body.category as string | undefined;
    const setting_key = body.setting_key as string | undefined;
    const setting_value = body.setting_value;
    const change_reason = body.change_reason as string | undefined;

    // 배치 모드: 서로를 해석하는 값들(교대 시작·휴식·유예)을 **한 트랜잭션**으로 저장한다.
    // 예전에는 화면이 네 번 따로 저장해서, 중간에 실패하면 앞의 값만 반영된 "혼합 세대"가
    // 남았다(적대적 재감사 #9). 그 상태로 계산된 OEE 는 어느 규칙으로 나온 값인지 알 수 없다.
    const updates = 'updates' in body ? normalizeUpdates(body.updates) : null;
    const isBatch = 'updates' in body;

    if (isBatch && updates === null) {
      return NextResponse.json(
        { success: false, error: 'updates는 category/setting_key를 가진 비어 있지 않은 배열이어야 합니다.' },
        { status: 400 }
      );
    }

    // 단건 모드(기존 호출자 호환)
    if (!isBatch && (!category || !setting_key)) {
      return NextResponse.json(
        { success: false, error: 'category와 setting_key는 필수입니다.' },
        { status: 400 }
      );
    }

    // ── 인가: 호출자가 실제로 관리자인지, 그리고 **어느 공장**인지 확인한다 ─────
    //
    // 예전에는 여기서 토큰을 직접 뜯어 user_profiles.role 을 봤다. 그 검사는 역할만 알고
    // 공장을 모른다. 설정은 공장마다 다른 값이므로, "관리자다"만으로는 어느 행을 고쳐야
    // 할지 정할 수 없다 — 그리고 정하지 못한 채 쓰면 아무 공장 행이나 고쳐진다.
    //
    // `requireFactoryUser` 가 세션·역할·공장을 한 번에 확정한다. 그 판정은 쿠키가 아니라
    // 활성 membership 이 내리므로, 쿠키를 위조해도 자기 소속 밖으로는 못 나간다.
    const authenticatedUser = await requireFactoryUser(request, ['admin']);

    // Service Role Key 확인
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      console.error('❌ SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.');
      return NextResponse.json(
        { success: false, error: 'Service Role이 구성되지 않았습니다.' },
        { status: 500 }
      );
    }

    // Service Role 클라이언트 생성
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      console.error('❌ NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다.');
      return NextResponse.json(
        { success: false, error: 'Supabase URL이 구성되지 않았습니다.' },
        { status: 500 }
      );
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // ──────────────────────────────────────────────────────────────────────────

    // 계약 검사는 배치·단건 **양쪽 모두** 거친다. 한쪽만 막으면 다른 쪽이 레거시 키를 계속
    // 만들어 낸다 — 실제로 라이브에 쌓인 11개 중 상당수가 단건 경로에서 왔다.
    // 배치는 하나라도 어긋나면 전체를 거부한다(RPC 자체가 all-or-nothing 이므로 같은 규칙이다).
    const violation = updates !== null
      ? contractViolation(updates)
      : contractViolation(
          // 단건 모드는 위에서 이미 category/setting_key 가 비어 있지 않음을 확인했다.
          // 그 사실을 단언(as)으로 다시 주장하는 대신 좁혀진 값으로 배열을 만든다.
          category && setting_key ? [{ category, setting_key, setting_value }] : [],
        );
    if (violation) {
      return NextResponse.json({ success: false, error: violation }, { status: 400 });
    }

    const reason = change_reason || '시스템 자동 업데이트';

    if (updates !== null) {
      console.log('🔧 설정 배치 업데이트 시도:', updates.map(u => `${u.category}.${u.setting_key}`));

      // plpgsql 함수 하나 = 한 트랜잭션. 중간에 실패하면 앞선 UPDATE 도 함께 되돌아가고,
      // 감사 로그도 같은 트랜잭션이라 이력이 어긋나지 않는다.
      const { data, error } = await serviceClient.rpc('update_system_settings_batch_scoped', {
        p_factory_id: authenticatedUser.factoryId,
        p_updates: updates.map(u => ({
          category: u.category,
          setting_key: u.setting_key,
          // RPC 는 text 를 받아 값 종류(문자열/숫자/불리언)를 스스로 판별한다.
          setting_value: String(u.setting_value),
        })),
        p_reason: reason,
        p_changed_by: authenticatedUser.userId,
      });

      const result = data as { ok?: boolean; reason?: string; updated?: number } | null;
      if (error || !result?.ok) {
        console.error('❌ 설정 배치 업데이트 실패:', error ?? result);
        return NextResponse.json(
          { success: false, error: `설정 업데이트 실패: ${error?.message ?? result?.reason ?? 'unknown'}` },
          { status: 500 }
        );
      }

      console.log(`✅ 설정 ${result.updated}건 원자적 저장 완료`);
      return NextResponse.json({ success: true, data: result });
    }

    console.log('🔧 Service Role을 통한 설정 업데이트 시도:', {
      category,
      setting_key,
      setting_value,
      change_reason
    });

    // RPC 함수 호출
    const { data, error } = await serviceClient
      .rpc('update_system_setting_scoped', {
        p_factory_id: authenticatedUser.factoryId,
        p_category: category,
        p_key: setting_key,
        p_value: setting_value,
        p_reason: reason,
        p_changed_by: authenticatedUser.userId
      });

    if (error) {
      console.error('❌ Service Role RPC 호출 실패:', error);
      return NextResponse.json(
        { success: false, error: `설정 업데이트 실패: ${error.message}` },
        { status: 500 }
      );
    }

    console.log('✅ Service Role을 통한 설정 업데이트 성공');
    return NextResponse.json({ success: true, data });

  } catch (error) {
    // 인가 실패(401/403)를 여기서 변환하지 않으면 전부 500 이 된다 — 호출자는 "서버가
    // 고장났다"와 "권한이 없다"를 구분하지 못한다.
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('❌ API 라우트에서 예외 발생:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: '서버 내부 오류가 발생했습니다. 관리자에게 문의하세요.'
      },
      { status: 500 }
    );
  }
}

// OPTIONS 요청 처리 (CORS)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
