/**
 * 공장 인지 서버 인가 계약 테스트.
 *
 * 계약: docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md 절대조건 2·4번, 5.1, 5.3
 *
 * 여기서 지키려는 명제는 두 개다.
 *
 *   1. **요청이 보낸 factory_id 는 권위가 없다.** body/query/header 어디에 있든 서버 해석과
 *      일치하는지 확인하는 용도로만 쓴다.
 *   2. **host 는 선택자일 뿐 보안 경계가 아니다.** host 가 공장을 지목해도 membership 이
 *      없으면 거부다.
 *
 * 둘 다 "통과시켜야 할 것을 통과시키는가"보다 **"막아야 할 것을 막는가"** 가 본질이라,
 * 아래 검사는 대부분 거부를 확인한다.
 */

// `next/server` 는 jsdom 에 없는 전역 Request 를 요구한다. apiAuth 가 NextResponse 를
// import 하므로 여기서도 대체한다 — 이 테스트는 응답 직렬화가 아니라 인가 판정을 본다.
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockGetUser = jest.fn();

interface QueryResult {
  data: unknown;
  error: unknown;
}

const tables: Record<string, QueryResult> = {};

function makeQuery(table: string) {
  const query: Record<string, unknown> & PromiseLike<QueryResult> = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve(tables[table] ?? { data: null, error: null }),
    single: () => Promise.resolve(tables[table] ?? { data: null, error: null }),
    // 목록 조회(`await query`)는 배열을 기본값으로 준다 — 단건 조회와 기본값이 다르다.
    then: (resolve, reject) =>
      Promise.resolve(tables[table] ?? { data: [], error: null }).then(resolve, reject),
  };
  return query;
}

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (table: string) => makeQuery(table),
  },
}));

import { requireFactoryUser, assertClaimedFactoryMatches, normalizeHostname } from '../factoryAuth';
import { ApiAuthError } from '../apiAuth';

const ALT = '00000000-0000-4000-8000-00000000a17e';
const ALV = '22222222-2222-2222-2222-222222222222';

function request(headers: Record<string, string> = {}) {
  const all: Record<string, string> = { authorization: 'Bearer token', ...headers };
  return {
    headers: { get: (k: string) => all[k.toLowerCase()] ?? null },
  } as never;
}

/** 기본: 활성 계정 + ALT 단일 membership + 도메인 매핑 없음 */
function givenSingleAltMembership() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  tables.user_profiles = { data: { is_active: true }, error: null };
  tables.factory_memberships = {
    data: [{ factory_id: ALT, role: 'admin', factories: { code: 'ALT', is_active: true } }],
    error: null,
  };
  tables.factory_domains = { data: null, error: null };
  tables.user_machine_assignments = { data: [], error: null };
  tables.global_admins = { data: null, error: null };
}

describe('requireFactoryUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(tables)) delete tables[key];
  });

  describe('요청이 보낸 factory_id 는 권위가 없다', () => {
    it('다른 공장을 주장하면 거부한다', async () => {
      givenSingleAltMembership();

      // 사용자는 ALT 소속인데 body 에 ALV 를 적어 보냈다.
      await expect(
        requireFactoryUser(request(), undefined, { claimedFactoryId: ALV })
      ).rejects.toThrow(ApiAuthError);
    });

    it('주장이 서버 해석과 같으면 통과한다', async () => {
      givenSingleAltMembership();

      const user = await requireFactoryUser(request(), undefined, { claimedFactoryId: ALT });
      expect(user.factoryId).toBe(ALT);
    });

    it('주장이 없으면 서버가 확정한 공장을 쓴다', async () => {
      givenSingleAltMembership();

      const user = await requireFactoryUser(request());
      expect(user.factoryId).toBe(ALT);
      expect(user.factoryCode).toBe('ALT');
    });

    it('조용히 서버 값으로 덮지 않는다', () => {
      // 덮어쓰면 다른 공장에 쓰려던 요청이 성공한 것처럼 보이고, 호출자는 자기가 무엇을
      // 했는지 모른다. 거부만이 그 사실을 알린다.
      expect(() => assertClaimedFactoryMatches(ALV, ALT)).toThrow(ApiAuthError);
      expect(() => assertClaimedFactoryMatches(ALT, ALT)).not.toThrow();
      expect(() => assertClaimedFactoryMatches(undefined, ALT)).not.toThrow();
      expect(() => assertClaimedFactoryMatches(null, ALT)).not.toThrow();
      expect(() => assertClaimedFactoryMatches('', ALT)).not.toThrow();
    });

    it('문자열이 아닌 주장도 거부한다', () => {
      // { factory_id: { toString: ... } } 같은 값이 느슨한 비교를 통과하면 안 된다.
      expect(() => assertClaimedFactoryMatches(123, ALT)).toThrow(ApiAuthError);
      expect(() => assertClaimedFactoryMatches({ id: ALT }, ALT)).toThrow(ApiAuthError);
    });
  });

  describe('host 는 선택자일 뿐 보안 경계가 아니다', () => {
    it('host 가 지목한 공장에 membership 이 없으면 거부한다', async () => {
      givenSingleAltMembership();
      // host 는 ALV 를 가리키는데 사용자는 ALT 소속이다.
      tables.factory_domains = {
        data: {
          factory_id: ALV,
          is_active: true,
          factories: { id: ALV, code: 'ALV', name: 'ALMUS VINA', default_language: 'vi', is_active: true },
        },
        error: null,
      };

      await expect(requireFactoryUser(request({ host: 'alv.example.com' }))).rejects.toThrow(
        ApiAuthError
      );
    });

    it('비활성 공장은 host 로 지목해도 해석되지 않는다', async () => {
      givenSingleAltMembership();
      tables.factory_domains = {
        data: {
          factory_id: ALV,
          is_active: true,
          factories: { id: ALV, code: 'ALV', name: 'ALMUS VINA', default_language: 'vi', is_active: false },
        },
        error: null,
      };

      // 공장이 비활성이면 host 해석이 실패하고, 단일 membership 경로로 ALT 가 된다.
      // 중요한 것은 ALV 로 진입하지 않는다는 점이다.
      const user = await requireFactoryUser(request({ host: 'alv.example.com' }));
      expect(user.factoryId).toBe(ALT);
    });
  });

  describe('membership 수에 따른 fail-closed', () => {
    it('membership 이 없으면 403 이다', async () => {
      givenSingleAltMembership();
      tables.factory_memberships = { data: [], error: null };

      await expect(requireFactoryUser(request())).rejects.toThrow(ApiAuthError);
    });

    it('membership 이 둘 이상이면 공장을 특정하지 않고 거부한다', async () => {
      givenSingleAltMembership();
      tables.factory_memberships = {
        data: [
          { factory_id: ALT, role: 'admin', factories: { code: 'ALT', is_active: true } },
          { factory_id: ALV, role: 'admin', factories: { code: 'ALV', is_active: true } },
        ],
        error: null,
      };

      // 임의로 하나를 고르면 사용자가 어느 공장에 쓰고 있는지 모르는 채로 쓰게 된다.
      await expect(requireFactoryUser(request())).rejects.toThrow(ApiAuthError);
    });

    it('비활성 공장의 membership 은 세지 않는다', async () => {
      givenSingleAltMembership();
      tables.factory_memberships = {
        data: [
          { factory_id: ALT, role: 'admin', factories: { code: 'ALT', is_active: true } },
          { factory_id: ALV, role: 'admin', factories: { code: 'ALV', is_active: false } },
        ],
        error: null,
      };

      // 공장 비활성화가 실제 차단 수단이어야 한다(계약 9절).
      const user = await requireFactoryUser(request());
      expect(user.factoryId).toBe(ALT);
    });
  });

  describe('계정과 역할', () => {
    it('비활성 계정은 거부한다', async () => {
      givenSingleAltMembership();
      tables.user_profiles = { data: { is_active: false }, error: null };

      await expect(requireFactoryUser(request())).rejects.toThrow(ApiAuthError);
    });

    it('허용되지 않은 역할은 거부한다', async () => {
      givenSingleAltMembership();
      tables.factory_memberships = {
        data: [{ factory_id: ALT, role: 'operator', factories: { code: 'ALT', is_active: true } }],
        error: null,
      };

      await expect(requireFactoryUser(request(), ['admin'])).rejects.toThrow(ApiAuthError);
    });

    it('역할은 공장 안에서만 의미를 갖는다 — user_profiles.role 을 읽지 않는다', async () => {
      givenSingleAltMembership();
      // 전역 프로필에는 role 이 없고 is_active 만 있다. 그래도 동작해야 한다.
      tables.user_profiles = { data: { is_active: true }, error: null };
      tables.factory_memberships = {
        data: [{ factory_id: ALT, role: 'engineer', factories: { code: 'ALT', is_active: true } }],
        error: null,
      };

      const user = await requireFactoryUser(request());
      expect(user.role).toBe('engineer');
    });

    it('토큰이 없으면 401 이다', async () => {
      await expect(
        requireFactoryUser({ headers: { get: () => null } } as never)
      ).rejects.toThrow(ApiAuthError);
    });
  });

  describe('담당 설비', () => {
    it('operator 만 담당 설비를 읽는다', async () => {
      givenSingleAltMembership();
      tables.factory_memberships = {
        data: [{ factory_id: ALT, role: 'operator', factories: { code: 'ALT', is_active: true } }],
        error: null,
      };
      tables.user_machine_assignments = {
        data: [{ machine_id: 'machine-1' }, { machine_id: 'machine-2' }],
        error: null,
      };

      const user = await requireFactoryUser(request());
      expect(user.assignedMachineIds).toEqual(['machine-1', 'machine-2']);
    });

    it('admin 은 담당 설비 목록이 비어 있고 공장 전체를 본다', async () => {
      givenSingleAltMembership();
      tables.user_machine_assignments = {
        data: [{ machine_id: 'machine-1' }],
        error: null,
      };

      const user = await requireFactoryUser(request());
      expect(user.assignedMachineIds).toEqual([]);
    });
  });
});

describe('normalizeHostname', () => {
  it('포트와 대소문자를 지운다', () => {
    // factory_domains.hostname 은 소문자로만 저장된다. 대소문자가 섞이면 같은 호스트가
    // 두 공장에 바인딩될 수 있고, 그것이 곧 잘못된 공장에 쓰기다.
    expect(normalizeHostname(request({ host: 'ALT.Example.COM:3000' }))).toBe('alt.example.com');
  });

  it('x-forwarded-host 를 우선한다', () => {
    // Vercel 이 원래 host 를 거기에 넣는다.
    expect(
      normalizeHostname(request({ host: 'internal', 'x-forwarded-host': 'alt.example.com' }))
    ).toBe('alt.example.com');
  });

  it('쉼표로 이어진 목록에서 첫 값을 쓴다', () => {
    expect(
      normalizeHostname(request({ 'x-forwarded-host': 'alt.example.com, proxy.internal' }))
    ).toBe('alt.example.com');
  });

  it('host 가 없으면 null 이다', () => {
    expect(normalizeHostname({ headers: { get: () => null } } as never)).toBeNull();
  });
});
