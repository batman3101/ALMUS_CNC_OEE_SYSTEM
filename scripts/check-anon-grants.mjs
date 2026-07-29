#!/usr/bin/env node
/**
 * 익명(anon) 접근 표면 블랙박스 검사.  사용: npm run check:grants
 *
 * ## 왜 카탈로그가 아니라 실제 호출인가
 *
 * 2026-07-29 적대적 재감사에서 백업 테이블 4개가 인증 없이 읽히고 지워질 수 있는 상태로
 * 발견됐다(3,850행짜리 생산 데이터 사본 포함). 직전 마이그레이션은 이미 "anon 권한을
 * 회수"했는데도 그랬다 — 테이블 **이름을 나열해서** 회수했고, 그 넷은 마이그레이션 밖에서
 * 만들어져 목록에 없었기 때문이다.
 *
 * 여기서 얻은 교훈은 "목록을 더 잘 관리하자"가 아니다. 열거는 아는 것만 덮고, 드리프트는
 * 정의상 모르는 것이라 **원리적으로** 놓친다. 그래서 이 검사는 목록을 신뢰하지 않는다:
 * 지금 REST 로 도달 가능한 것을 스키마에서 열거한 뒤, 하나하나를 **anon 키로 실제로
 * 두드려 본다.** 공격자와 같은 자리에서 보므로 경로가 어떤 이유로 열리든 나타난다.
 *
 * ## 이 검사가 일부러 하지 **않는** 것 — 휘발성 RPC 실행
 *
 * RPC 도 같은 방식으로 확인하고 싶지만, 인자를 모르는 채 호출하면 두 가지 함정이 있다.
 *
 *  1. 인자 이름이 틀리면 PostgREST 는 404(PGRST202, 시그니처 불일치)를 준다. 이건 "권한
 *     없음"과 구별되지 않는다 — 처음 구현에서 32개를 전부 노출로 오판했다.
 *  2. 인자 이름을 스펙에서 읽어 맞추면 시그니처는 통과하지만, 그 순간 **함수 본문이 실제로
 *     실행된다.** 쓰기 RPC 라면 검사기가 운영 데이터를 바꾼다. `Prefer: tx=rollback` 은
 *     이 프로젝트의 PostgREST 에서 적용되지 않는다(응답에 `Preference-Applied` 없음 —
 *     실측 확인).
 *
 * 그래서 실행 검사는 **비휘발성 함수로만** 한정한다. PostgREST 는 STABLE·IMMUTABLE 함수만
 * GET 으로도 노출하므로, OpenAPI 에 `get` 경로가 있는지가 곧 "실행해도 쓰기가 없다"는
 * 보증이다. VOLATILE 함수(POST 전용)의 권한은 실행하지 않고 카탈로그로 확인해야 하며,
 * 그건 `supabase/tests/anon_access_invariants.sql` 이 맡는다 — SQL 을 쓸 수 있는 자리라
 * `has_function_privilege('anon', ...)` 로 **존재하는 모든 함수**를 한 번에 볼 수 있다.
 * (두 검사가 함께 있어야 표면 전체가 덮인다. 어느 한쪽만으로는 구멍이 남는다.)
 */

try {
  process.loadEnvFile('.env.local');
} catch {
  // CI 등 파일이 없는 환경에서는 이미 주입된 process.env 를 쓴다.
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  process.exit(2);
}

/**
 * 지금 REST 로 도달 가능한 테이블·뷰·RPC 를 운영 스키마에서 열거한다.
 * 저장소의 마이그레이션 목록에서 얻으면 애초의 실패(드리프트로 생긴 객체를 모름)를 반복한다.
 *
 * anon 키로 이 스펙을 받으면 0개가 돌아온다(Supabase 가 익명에게 스키마를 주지 않는다).
 * 그래서 **열거는 service_role 로, 판정은 anon 으로** 한다.
 */
async function enumerateSurface() {
  const res = await fetch(`${URL}/rest/v1/`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  if (!res.ok) throw new Error(`스키마 조회 실패: HTTP ${res.status}`);
  const spec = await res.json();

  const tables = [];
  const readOnlyRpcs = [];
  const volatileRpcs = [];
  for (const [route, methods] of Object.entries(spec.paths ?? {})) {
    if (route === '/') continue;
    if (!route.startsWith('/rpc/')) {
      tables.push(route.slice(1));
      continue;
    }
    const name = route.slice(5);
    if (!('get' in methods)) {
      volatileRpcs.push(name);
      continue;
    }
    // 인자 이름을 스펙에서 그대로 가져온다. 이름이 안 맞으면 PostgREST 가 404(PGRST202)를
    // 주는데 그건 "권한 없음"과 구별되지 않아 검사가 통째로 무의미해진다(초기 구현의 오판).
    const body = (methods.post?.parameters ?? []).find(p => p.in === 'body');
    readOnlyRpcs.push({ name, params: Object.keys(body?.schema?.properties ?? {}) });
  }
  return {
    tables: tables.sort(),
    readOnlyRpcs: readOnlyRpcs.sort((a, b) => a.name.localeCompare(b.name)),
    volatileRpcs: volatileRpcs.sort(),
  };
}

const anonHeaders = { apikey: ANON, Authorization: `Bearer ${ANON}` };

/** anon 으로 실제 조회를 시도한다. 2xx 면 노출(행 내용은 받지 않고 개수만 센다). */
async function probeTable(name) {
  const res = await fetch(`${URL}/rest/v1/${name}?select=*&limit=0`, {
    headers: { ...anonHeaders, Prefer: 'count=exact' },
  });
  return { name, status: res.status, exposed: res.ok, count: res.headers.get('content-range') };
}

/**
 * 비휘발성 RPC 를 anon 으로 호출한다. 인자는 스펙에서 읽은 **이름 그대로, 값은 null** 로
 * 채워 시그니처를 맞춘다. 그래야 PostgREST 의 404(시그니처 불일치)가 아니라 Postgres 의
 * 권한 판정이 응답을 결정한다. STABLE·IMMUTABLE 이라 실행돼도 쓰기가 없다.
 *
 * 차단 신호는 42501(권한 거부) 또는 401/403 이다. PGRST202(함수를 못 찾음)는 스키마
 * 캐시에서 안 보인다는 뜻이라 역시 도달 불가로 본다.
 */
async function probeReadOnlyRpc({ name, params }) {
  const args = Object.fromEntries(params.map(p => [p, null]));
  const res = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...anonHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await res.text();
  const denied =
    res.status === 401 || res.status === 403 ||
    body.includes('42501') || body.includes('PGRST202');
  return { name, status: res.status, exposed: !denied };
}

const { tables, readOnlyRpcs, volatileRpcs } = await enumerateSurface();
console.log(`검사 대상: 테이블/뷰 ${tables.length}개, 비휘발성 RPC ${readOnlyRpcs.length}개`);
console.log(`실행 검사 제외(휘발성 RPC ${volatileRpcs.length}개 — SQL 불변조건 파일이 담당)\n`);

const exposedTables = (await Promise.all(tables.map(probeTable))).filter(r => r.exposed);
const exposedRpcs = (await Promise.all(readOnlyRpcs.map(probeReadOnlyRpc))).filter(r => r.exposed);

for (const r of exposedTables) console.error(`❌ 테이블 익명 노출: ${r.name}  HTTP ${r.status}  ${r.count ?? ''}`);
for (const r of exposedRpcs) console.error(`❌ RPC 익명 실행 가능: ${r.name}  HTTP ${r.status}`);

if (exposedTables.length || exposedRpcs.length) {
  console.error(
    `\n익명 접근 가능한 진입점 ${exposedTables.length + exposedRpcs.length}개.\n` +
    '전수 회수로 닫으세요(이름 나열 금지):\n' +
    '  revoke all on all tables in schema public from anon;\n' +
    '  revoke execute on function public.<name>(<args>) from anon;\n' +
    '미래 객체 기본값도 함께 닫아야 재발하지 않습니다:\n' +
    '  alter default privileges in schema public revoke all on tables from anon;',
  );
  process.exit(1);
}

console.log('✅ 익명 키로 도달 가능한 public 테이블·비휘발성 RPC 가 없습니다.');
console.log('   (휘발성 RPC 권한은 supabase/tests/anon_access_invariants.sql 로 확인하세요.)');
