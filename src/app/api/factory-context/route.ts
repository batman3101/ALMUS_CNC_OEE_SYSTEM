import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { requireFactoryUser, saveFactorySelection } from '@/lib/factoryAuth';
import { requireUser } from '@/lib/apiAuth';

/**
 * GET /api/factory-context — 현재 세션이 어느 공장에 있고, 어디로 갈 수 있는가.
 *
 * ## 왜 별도 엔드포인트인가
 *
 * 화면이 "지금 어느 공장인지"를 **추측하면 안 된다.** 쿠키를 클라이언트가 직접 읽어
 * 표시하면, 서버가 그 값을 거부했을 때(만료된 membership, 비활성 공장) 화면은 여전히
 * 그 공장을 가리킨다. 사용자는 자기가 ALV 를 보고 있다고 믿으면서 ALT 데이터를 본다.
 *
 * 그래서 **서버가 판정한 결과**를 그대로 받아 표시한다. 화면의 공장 표시와 API 응답의
 * 공장이 항상 같아진다.
 *
 * ## 목록은 자기 소속만
 *
 * `available` 은 이 사용자의 활성 membership 뿐이다. 전체 공장 목록이 아니다 —
 * 일반 사용자에게 다른 공장이 존재한다는 사실 자체를 알릴 이유가 없다.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer', 'operator']);

    const { data, error } = await supabaseAdmin
      .from('factory_memberships')
      .select('role, factories!inner(id, code, name, is_active)')
      .eq('user_id', user.userId)
      .eq('is_active', true);

    if (error) {
      console.error('공장 목록 조회 실패:', error);
      return NextResponse.json({ success: false, error: 'Failed to fetch factories' }, { status: 500 });
    }

    const available = (data ?? [])
      .map(row => {
        const f = Array.isArray(row.factories) ? row.factories[0] : row.factories;
        return f?.is_active ? { code: f.code, name: f.name, role: row.role } : null;
      })
      .filter((f): f is { code: string; name: string; role: string } => f !== null)
      .sort((a, b) => a.code.localeCompare(b.code));

    return NextResponse.json({
      success: true,
      // id 를 함께 돌려준다. Realtime 구독의 서버 측 필터(`factory_id=eq.<id>`)는 코드가
      // 아니라 id 를 요구한다. 비밀이 아니다 — 경계는 RLS 가 지키고, id 를 알아도 남의
      // 공장 행에는 닿지 못한다.
      current: { id: user.factoryId, code: user.factoryCode, role: user.role },
      isGlobalAdmin: user.isGlobalAdmin,
      // 선택기는 갈 곳이 둘 이상일 때만 의미가 있다. 판정을 서버에서 끝내 두면
      // 화면은 이 값만 보고 그리면 된다.
      canSwitch: available.length > 1,
      available,
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('공장 컨텍스트 조회 오류:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/factory-context — 공장을 바꾼다.
 *
 * ## 왜 서버가 저장하는가
 *
 * 선택이 브라우저 쿠키에 있으면 **RLS 가 그것을 보지 못한다.** 그래서 Route 가 주는 데이터와
 * 브라우저가 직접 읽는 데이터가 서로 다른 공장이 된다(2026-08-24 실측). 선택을 DB 행으로
 * 두면 두 층이 같은 것을 읽는다 — `@/lib/factoryAuth` 의 설명 참고.
 *
 * ## 왜 requireFactoryUser 가 아닌가
 *
 * `requireFactoryUser` 는 **현재 공장을 확정**한다. 그런데 저장된 선택이 무효가 된 경우
 * (그 공장의 membership 이 사라진 경우) 그 함수는 403 을 던진다 — 그러면 사용자는 다른
 * 공장으로 **빠져나올 수도 없다.**
 *
 * 전환은 "지금 어디 있는지"와 무관해야 하므로, 여기서는 세션만 확인하고 목적지 공장의
 * 권한은 `saveFactorySelection` 이 직접 검사한다.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireUser(request, ['admin', 'engineer', 'operator']);

    const body = await request.json().catch(() => null);
    const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
    // 형식 검사는 인가 앞에 둔다 — 이 검사는 어떤 공장이 존재하는지 알려주지 않는다.
    if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(code)) {
      return NextResponse.json({ success: false, error: 'Invalid factory code' }, { status: 400 });
    }

    const saved = await saveFactorySelection(userId, code);

    return NextResponse.json({ success: true, current: { id: saved.factoryId, code: saved.factoryCode } });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('공장 전환 오류:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
