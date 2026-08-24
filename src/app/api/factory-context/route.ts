import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';

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
