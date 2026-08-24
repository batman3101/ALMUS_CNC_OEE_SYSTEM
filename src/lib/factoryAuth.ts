import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ApiAuthError, type UserRole } from '@/lib/apiAuth';

/**
 * 공장 인지 서버 인가 (서버 전용).
 *
 * 계약: docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md 5.1 / 5.3
 *
 * ## 왜 `requireUser` 를 고치지 않고 새로 만드나
 *
 * Route 44개 / method 77개를 한 번에 옮길 수 없다. `requireUser` 의 시그니처를 바꾸면
 * 그 전부가 동시에 깨지고, 그러면 "부분적으로 옮긴 상태"에서 무엇이 안전한지 알 수 없다.
 *
 * 대신 새 계약을 옆에 두고 하나씩 옮긴다. 옮긴 Route 는 공장 경계를 갖고, 안 옮긴 Route 는
 * 예전 그대로다 — **어느 쪽인지가 코드에서 바로 보인다.** 이행 상태가 눈에 보이는 것이
 * 이행 중 안전의 전부다.
 *
 * 전환이 끝나면 `requireUser` 는 제거된다(계약 7절 P4).
 *
 * ## 절대 규칙
 *
 * 요청이 보낸 `factory_id` 는 **권위 있는 값이 아니다**(계약 절대조건 4번). body/query/header
 * 어디에 있든 서버가 해석한 값과 **일치하는지 확인하는 용도**로만 쓴다. 불일치는 거부다.
 *
 * host 는 공장 **선택자**일 뿐 보안 경계가 아니다(절대조건 2번). host 로 후보를 고르고,
 * 최종 인가는 `factory_memberships` 가 한다.
 */

export interface FactoryUser {
  userId: string;
  factoryId: string;
  factoryCode: string;
  /** 이 공장 안에서의 역할. 전역 역할이 아니다. */
  role: UserRole;
  /** operator 의 담당 설비. admin/engineer 는 빈 배열이며 공장 전체를 본다. */
  assignedMachineIds: string[];
  isGlobalAdmin: boolean;
}

interface ActiveMembership {
  factory_id: string;
  role: string;
  factories: { code: string; is_active: boolean } | null;
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'engineer' || value === 'operator';
}

/**
 * 신뢰할 수 있는 hostname 을 뽑는다.
 *
 * `x-forwarded-host` 를 먼저 보는 이유는 Vercel 이 원래 host 를 거기에 넣기 때문이다.
 * 포트와 대소문자를 지운다 — `factory_domains.hostname` 은 소문자로만 저장되며,
 * 대소문자가 섞이면 같은 호스트가 두 공장에 바인딩될 수 있고 그것이 곧 잘못된 공장에 쓰기다.
 */
/**
 * 이 사용자가 고른 공장(저장된 선택). 없으면 null.
 *
 * ## 왜 쿠키가 아닌가 (2026-08-24 변경)
 *
 * 예전에는 `almus_factory` 쿠키였다. 쿠키는 요청 헤더로 오므로 서버 Route 는 읽지만
 * **RLS 정책은 읽지 못한다** — 정책은 DB 안에서 돌고, 요청에 무엇이 실렸는지 알 방법이 없다.
 *
 * 그래서 두 층이 서로 다른 공장을 가리켰다(브랜치 브라우저 검증 실측):
 *
 *   쿠키 ALV -> Route(Service Role)      -> 설비 350대  (ALV)
 *   쿠키 ALV -> 브라우저 직접 조회(RLS)  -> 교대 08:00  (ALT)
 *
 * 소속이 하나인 사용자는 RLS 가 그 하나로 확정되므로 영향이 없다. 영향받는 것은 정확히
 * **양쪽을 오가는 사람**, 즉 이 기능을 실제로 쓰는 사람이다.
 *
 * 선택을 DB 행으로 두면 `current_user_factory()` 도 **같은 행**을 읽는다. 같은 것을 읽으면
 * 어긋날 수 없다 — 그것이 이 변경의 전부다.
 *
 * ## 이 값은 권위가 없다
 *
 * 저장돼 있다고 통과시키지 않는다. 아래 `requireFactoryUser` 가 **활성 membership 안에
 * 있는지** 확인한다 — membership 은 선택을 저장한 뒤에 사라질 수 있고, 그때 이 행은 조용히
 * 낡는다.
 */
export async function readStoredFactorySelection(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('user_factory_selection')
    .select('factory_id')
    .eq('user_id', userId)
    .maybeSingle();

  // 조회 실패를 "선택 없음"으로 뭉개지 않는다. 뭉개면 사용자가 고른 공장이 아니라 기본
  // 공장으로 조용히 넘어가고, 그것이 바로 없애려던 "모른 채로 쓰는" 상태다.
  if (error) {
    throw new ApiAuthError('공장 선택을 확인할 수 없습니다', 403);
  }
  return data?.factory_id ?? null;
}

/**
 * 공장 선택을 저장한다.
 *
 * 목적지 공장의 권한을 **여기서** 검사한다. DB 트리거(20260824190000)가 마지막 방어선이지만,
 * 트리거만 믿으면 실패가 23514 예외로 올라와 사용자에게 보여줄 문구를 만들 수 없고,
 * 여기서만 검사하면 다른 쓰기 경로가 생겼을 때 무방비다. 두 곳 모두에 둔다.
 */
export async function saveFactorySelection(userId: string, factoryCode: string): Promise<{
  factoryId: string;
  factoryCode: string;
}> {
  const { data: membership, error } = await supabaseAdmin
    .from('factory_memberships')
    .select('factory_id, factories!inner(code, is_active)')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('factories.code', factoryCode)
    .maybeSingle();

  if (error) {
    throw new ApiAuthError('공장 권한을 확인할 수 없습니다', 403);
  }
  const factory = membership
    ? (Array.isArray(membership.factories) ? membership.factories[0] : membership.factories)
    : null;
  if (!membership || !factory || factory.is_active !== true) {
    throw new ApiAuthError('선택한 공장에 대한 권한이 없습니다', 403);
  }

  const { error: upsertError } = await supabaseAdmin
    .from('user_factory_selection')
    .upsert(
      { user_id: userId, factory_id: membership.factory_id, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

  if (upsertError) {
    throw new ApiAuthError('공장 선택을 저장하지 못했습니다', 403);
  }

  return { factoryId: membership.factory_id, factoryCode: factory.code };
}

export function normalizeHostname(request: NextRequest): string | null {
  const raw = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!raw) return null;
  const host = raw.split(',')[0].trim().toLowerCase().split(':')[0];
  return host.length > 0 ? host : null;
}

/**
 * 로그인 **전** 브랜딩용 최소 공개 공장 정보.
 *
 * 계약 6.1: "로그인 전 branding 은 host 로 해석한 최소 공개 factory metadata 만 사용한다."
 * 그리고 "설정 조회 실패 시 ALT 이름·로고로 조용히 fallback 하지 않는다" — 그래서 실패는
 * `null` 이고, 호출자는 그것을 "모른다"로 표시해야 한다.
 */
export async function resolvePublicFactoryByHost(hostname: string | null): Promise<{
  id: string;
  code: string;
  name: string;
  defaultLanguage: string;
} | null> {
  if (!hostname) return null;

  const { data, error } = await supabaseAdmin
    .from('factory_domains')
    .select('factory_id, is_active, factories!inner(id, code, name, default_language, is_active)')
    .eq('hostname', hostname)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;

  const factory = Array.isArray(data.factories) ? data.factories[0] : data.factories;
  if (!factory || factory.is_active !== true) return null;

  return {
    id: factory.id,
    code: factory.code,
    name: factory.name,
    defaultLanguage: factory.default_language,
  };
}

/**
 * 요청의 공장을 확정하고 그 공장에서의 권한을 검증한다.
 *
 * 순서(계약 5.1):
 *   1. 정규화된 hostname
 *   2. `factory_domains` 에서 active factory 후보
 *   3. 알 수 없거나 비활성인 host 는 fail-closed
 *   4. 인증 사용자의 active membership 검증
 *   5. 요청이 보낸 factory 값이 있으면 **일치 검증만**
 *
 * ## 도메인이 아직 없을 때
 *
 * `factory_domains` 는 D3 미확정이라 비어 있을 수 있다. 그때 host 해석은 실패하고,
 * 사용자의 **활성 membership 이 정확히 하나**면 그 공장으로 진입한다(계약 1절 기본 사용자
 * 정책). 0개면 403, 2개 이상이면 승인된 공장 선택 UX 가 없으므로 **fail-closed** 다.
 *
 * 이것은 host 를 우회하는 뒷문이 아니다. host 가 해석되면 membership 은 그 공장과
 * 일치해야 하며, 불일치는 거부다.
 */
export async function requireFactoryUser(
  request: NextRequest,
  allowedRoles?: UserRole[],
  options?: { claimedFactoryId?: unknown }
): Promise<FactoryUser> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    throw new ApiAuthError('인증이 필요합니다', 401);
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) {
    throw new ApiAuthError('유효하지 않은 세션입니다', 401);
  }
  const userId = authData.user.id;

  // 계정 자체가 살아 있는가. 비활성 계정은 어떤 공장 데이터도 볼 수 없다.
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('is_active')
    .eq('user_id', userId)
    .single();
  if (profileError || !profile) {
    throw new ApiAuthError('사용자 프로필을 찾을 수 없습니다', 403);
  }
  if (profile.is_active !== true) {
    throw new ApiAuthError('비활성화된 계정입니다', 403);
  }

  // 활성 membership 전부. 비활성 공장은 제외한다 — 공장 비활성화가 실제 차단 수단이어야
  // 한다(계약 9절: ALV 장애 시 domain/membership/schedule 을 비활성화한다).
  const { data: membershipRows, error: membershipError } = await supabaseAdmin
    .from('factory_memberships')
    .select('factory_id, role, factories!inner(code, is_active)')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (membershipError) {
    throw new ApiAuthError('공장 권한을 확인할 수 없습니다', 403);
  }

  const memberships = ((membershipRows ?? []) as unknown as ActiveMembership[]).filter(row => {
    const factory = Array.isArray(row.factories) ? row.factories[0] : row.factories;
    return factory?.is_active === true;
  });

  const hostname = normalizeHostname(request);
  const hostFactory = await resolvePublicFactoryByHost(hostname);
  const storedSelection = await readStoredFactorySelection(userId);

  let selected: ActiveMembership | undefined;

  /**
   * 사용자가 UI 에서 고른 공장이 최우선이다.
   *
   * 이 앱은 **도메인 하나**로 운영한다(운영 결정 2026-08-24). 그래서 host 는 대부분의
   * 배포에서 공장을 구분하지 못하고, 실제 선택 수단은 사용자의 명시적 선택이다.
   *
   * ## 순서는 current_user_factory() 와 같아야 한다
   *
   *   선택 -> host -> 단일 membership -> 명시적 기본 공장 -> 거부
   *
   * RLS 쪽에는 host 개념이 없다. 지금 배포에서 host 는 공장을 지목하지 못하므로 두 순서는
   * 실질적으로 동일하다 — host 매핑을 쓰기 시작하면 그때 RLS 쪽도 함께 정해야 한다.
   *
   * 선택값 자체는 신뢰하지 않는다 — **활성 membership 안에 있을 때만** 통과한다. 없으면
   * 조용히 다른 공장으로 넘기지 않고 거부한다. 조용히 넘기면 관리자는 자기가 어느 공장을
   * 보고 있는지 모른 채로 쓰게 된다.
   */
  if (storedSelection) {
    selected = memberships.find(row => row.factory_id === storedSelection);
    if (!selected) {
      throw new ApiAuthError('선택한 공장에 대한 권한이 없습니다', 403);
    }
  } else if (hostFactory) {
    // host 가 공장을 지목했다. 그 공장의 membership 이 없으면 거부다 —
    // host 는 선택자일 뿐이므로 여기서 통과시키면 경계가 사라진다.
    selected = memberships.find(row => row.factory_id === hostFactory.id);
    if (!selected) {
      throw new ApiAuthError('이 공장에 대한 권한이 없습니다', 403);
    }
  } else if (memberships.length === 1) {
    // 도메인 매핑이 아직 없다. 활성 membership 이 하나면 모호함이 없다.
    selected = memberships[0];
  } else if (memberships.length === 0) {
    throw new ApiAuthError('소속된 공장이 없습니다', 403);
  } else {
    // 2개 이상이고 host 가 공장을 지목하지 못했다.
    //
    // 시스템 관리자는 ALT/ALV 를 모두 관리한다(운영 결정 2026-08-24). 그런데 프론트엔드에
    // 공장 전환 토글은 두지 않기로 했다(같은 결정 3번). 그래서 이 사용자에게 host 는
    // 유일한 선택 수단이고, host 가 해석되지 않으면 들어갈 공장이 정해지지 않는다.
    //
    // 해법은 "여러 공장이면 아무거나"가 아니라 **명시적 기본 공장**이다. 어느 쪽을 고를지
    // 사람이 미리 적어 두면 임의 선택이 아니게 된다 — 사용자는 자기가 어느 공장에 쓰고
    // 있는지 항상 알 수 있다.
    //
    // 기본 공장이 없으면 예전대로 거부한다. 관리자를 양쪽에 넣어 두고 기본값을 안 정하면
    // 그것은 구성이 덜 끝난 상태이지, 아무 공장이나 써도 된다는 뜻이 아니다.
    const homeFactoryId = await resolveHomeFactoryId(userId);
    selected = homeFactoryId
      ? memberships.find(row => row.factory_id === homeFactoryId)
      : undefined;

    if (!selected) {
      throw new ApiAuthError(
        '여러 공장에 소속되어 있고 기본 공장이 지정되지 않았습니다',
        403
      );
    }
  }

  const factory = Array.isArray(selected.factories) ? selected.factories[0] : selected.factories;
  if (!factory) {
    throw new ApiAuthError('공장 정보를 찾을 수 없습니다', 403);
  }

  if (!isUserRole(selected.role)) {
    throw new ApiAuthError('유효하지 않은 사용자 역할입니다', 403);
  }
  const role = selected.role;

  if (allowedRoles && !allowedRoles.includes(role)) {
    throw new ApiAuthError('권한이 없습니다', 403);
  }

  // 요청이 factory 를 주장했다면 **일치 검증만** 한다. 이 값으로 공장을 고르지 않는다.
  assertClaimedFactoryMatches(options?.claimedFactoryId, selected.factory_id);

  // operator 만 담당 설비를 읽는다. admin/engineer 는 공장 전체를 보므로 조회가 낭비다.
  let assignedMachineIds: string[] = [];
  if (role === 'operator') {
    const { data: assignments, error: assignmentError } = await supabaseAdmin
      .from('user_machine_assignments')
      .select('machine_id')
      .eq('factory_id', selected.factory_id)
      .eq('user_id', userId)
      .eq('is_active', true);

    if (assignmentError) {
      throw new ApiAuthError('담당 설비를 확인할 수 없습니다', 403);
    }
    assignedMachineIds = (assignments ?? [])
      .map(row => row.machine_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  const { data: globalAdmin } = await supabaseAdmin
    .from('global_admins')
    .select('user_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  return {
    userId,
    factoryId: selected.factory_id,
    factoryCode: factory.code,
    role,
    assignedMachineIds,
    isGlobalAdmin: Boolean(globalAdmin),
  };
}

/**
 * 여러 공장에 소속된 사용자의 **기본 공장**.
 *
 * `global_admins.home_factory_id` 에 사람이 명시적으로 적어 둔 값이다. 없으면 `null` 이고,
 * 호출자는 그때 거부한다 — 기본값 없는 다중 소속은 "아무 공장이나 좋다"가 아니라
 * "구성이 덜 끝났다"이다.
 *
 * host 가 공장을 지목했다면 이 함수는 아예 불리지 않는다. 기본 공장은 host 를 덮지 않고
 * host 가 없을 때만 쓰인다 — 그래야 `alv.<domain>` 으로 들어간 관리자가 ALV 를 본다.
 */
async function resolveHomeFactoryId(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('global_admins')
    .select('home_factory_id, is_active, expires_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data?.home_factory_id) return null;
  // 만료된 전역 권한으로 기본 공장을 얻으면 권한이 조용히 연장된 것과 같다.
  if (data.expires_at && Date.parse(data.expires_at) <= Date.now()) return null;
  return data.home_factory_id;
}

/**
 * 요청이 보낸 factory 값이 서버 해석과 같은지 확인한다.
 *
 * 값이 없으면 통과다 — 대부분의 Route 는 factory 를 보내지 않으며 서버가 stamp 한다.
 * 값이 있는데 다르면 **거부**다. 조용히 서버 값으로 덮으면, 다른 공장에 쓰려던 요청이
 * 성공한 것처럼 보이고 호출자는 자기가 무엇을 했는지 모른다.
 */
export function assertClaimedFactoryMatches(claimed: unknown, resolvedFactoryId: string): void {
  if (claimed === undefined || claimed === null || claimed === '') return;
  if (typeof claimed !== 'string' || claimed !== resolvedFactoryId) {
    throw new ApiAuthError('요청한 공장이 현재 세션의 공장과 일치하지 않습니다', 403);
  }
}

/**
 * operator 의 담당 설비 검사. 공장은 이미 `requireFactoryUser` 가 확정했으므로
 * 여기서는 설비만 본다.
 */
export function assertFactoryMachineAccess(user: FactoryUser, machineId: string): void {
  if (user.role === 'operator' && !user.assignedMachineIds.includes(machineId)) {
    throw new ApiAuthError('담당 설비에 대한 권한이 없습니다', 403);
  }
}
