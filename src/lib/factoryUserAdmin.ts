import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * 사용자 관리를 공장 안으로 가둔다.
 *
 * ## 왜 필요한가
 *
 * `/api/admin/users` 계열은 다중화 전환에서 통째로 빠져 있었다. `requireUserManager` 는
 * 역할만 묻고 공장을 묻지 않으며, 아래 query 들은 Service Role 로 돌아 RLS 를 우회한다.
 * 그래서 ALV 의 관리자가 **ALT 사용자 목록을 보고, 이름과 역할을 바꾸고, 계정을 지울 수**
 * 있었다.
 *
 * 이 결함이 `factoryScopedRoutes` 원장에 걸리지 않은 이유: 그 원장은 `factory_id` 컬럼을
 * 가진 테이블(`FACTORY_OWNED`)을 만지는 Route 만 본다. `user_profiles` 에는 그 컬럼이 없다 —
 * 사용자의 공장은 `factory_memberships` 가 말한다. 원장이 "공장 소유"를 컬럼 유무로 정의한
 * 탓에, 공장에 속하지만 컬럼이 없는 이 테이블이 통째로 시야 밖이었다.
 *
 * ## 없는 것과 남의 것을 구분해 주지 않는다
 *
 * 다른 공장 사용자를 지목하면 403 이 아니라 **404** 다. 403 은 "그 id 는 존재한다"를
 * 알려준다 — 그것만으로도 다른 공장의 사용자 id 를 하나씩 확인할 수 있다.
 * `assertMachineInFactory`(machineUpdate.ts)와 같은 규칙이다.
 *
 * `ApiAuthError` 는 401/403 만 표현한다 — 여기 필요한 404/409/500 은 인가 실패가 아니므로
 * 그 타입을 넓히지 않고, `MachineNotFoundError` 와 같은 방식으로 전용 오류를 쓴다.
 */

/** 이 공장에 그런 사용자가 없다. 다른 공장에 있는지 여부는 알려주지 않는다. */
export class FactoryUserNotFoundError extends Error {}
/** 여러 공장에 걸친 사용자라 이 공장만으로 계정을 지울 수 없다. */
export class CrossFactoryUserError extends Error {}
/** membership 조회 자체가 실패했다. "구성원이 아니다"와 구분해야 한다. */
export class FactoryMembershipLookupError extends Error {}

/**
 * 위 오류들을 HTTP 응답으로 옮긴다. `apiAuthErrorResponse` 와 같은 자리에서 같은 방식으로
 * 쓰라고 만든 것이다 — 라우트마다 instanceof 를 늘어놓으면 한 곳이 빠지고, 빠진 곳은
 * 404 여야 할 것을 500 으로 돌려준다.
 */
export function factoryUserErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof FactoryUserNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof CrossFactoryUserError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof FactoryMembershipLookupError) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return null;
}

/** 이 공장의 활성 구성원 user_id 목록. */
export async function factoryMemberIds(factoryId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('factory_memberships')
    .select('user_id')
    .eq('factory_id', factoryId)
    .eq('is_active', true);

  if (error) {
    throw new FactoryMembershipLookupError('공장 구성원을 확인할 수 없습니다');
  }
  return (data ?? []).map(row => row.user_id as string);
}

/** 대상이 이 공장의 활성 구성원이 아니면 404. */
export async function assertTargetInFactory(factoryId: string, userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('factory_memberships')
    .select('user_id')
    .eq('factory_id', factoryId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new FactoryMembershipLookupError('공장 구성원을 확인할 수 없습니다');
  }
  if (!data) {
    throw new FactoryUserNotFoundError('사용자를 찾을 수 없습니다');
  }
}

/**
 * 계정 삭제 전에, 이 공장이 그 사용자의 **유일한 공장**인지 확인한다.
 *
 * 계정 삭제는 `auth.users` 행까지 지우므로 공장 하나의 결정으로 끝날 일이 아니다. 두 공장에
 * 걸친 사용자를 ALT 관리자가 지우면 ALV 에서도 그 사람이 사라지고, ALV 관리자는 이유를 알
 * 방법이 없다.
 *
 * 지금 두 공장에 걸치는 사람은 공동 관리자 한 명뿐이라 이 거부가 실제로 막는 경우는 거의
 * 없다. 그래도 거부해 둔다 — 드문 일일수록 잘못됐을 때 알아채기 어렵다.
 */
export async function assertSoleFactory(userId: string, factoryId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('factory_memberships')
    .select('factory_id')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error) {
    throw new FactoryMembershipLookupError('공장 구성원을 확인할 수 없습니다');
  }

  const others = (data ?? []).map(row => row.factory_id as string).filter(id => id !== factoryId);
  if (others.length > 0) {
    throw new CrossFactoryUserError(
      '이 사용자는 다른 공장에도 소속되어 있어 여기서 계정을 삭제할 수 없습니다'
    );
  }
}
