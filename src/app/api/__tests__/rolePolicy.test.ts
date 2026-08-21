/**
 * API 라우트 권한 정책 원장(자체 감사 #6 + 후속: 메서드별 구분).
 *
 * 문제: 역할 배열이 30여 개 route.ts 에 손으로 박혀 있어 "엔지니어가 어디에 쓸 수 있나"
 * 같은 정책 질문에 전 라우트 grep 이 필요했고, 새 라우트가 정책 검토 없이 추가될 수 있었다.
 * 초판은 한 파일 안의 역할 배열을 다중집합으로만 비교해, GET 과 DELETE 의 역할이 서로
 * 뒤바뀌어도 통과했다(후속 지적). 이 판은 **HTTP 메서드별로** 역할을 고정한다.
 *
 * 원장 갱신 규칙:
 *  - 라우트/메서드를 추가·변경하면 POLICY 의 해당 (route, method) 항목도 갱신한다.
 *  - requireUser 가 없는 메서드는 'NONE' 으로 명시(사유는 EXEMPT_METHODS 주석).
 *  - 파일 전체에 requireUser 가 없으면 EXEMPT 에 사유와 함께 둔다.
 *
 * 정책 결정 기록
 *  - 2026-07-20: engineer 의 생산 데이터 쓰기 허용(CLAUDE.md).
 *  - 2026-07-31: 3등급 체계 확정. **관리자(engineer)는 '설정'을 제외한 모든 페이지 CRUD**.
 *    그래서 설비 관리·모델 등록·기록 삭제·사용자 관리가 admin 전용에서 admin+engineer 로
 *    넓어졌다. `system-settings` 쓰기와 `upload/image`(설정의 회사 로고), 그리고 최초
 *    관리자 생성(`admin/setup-real-user`)만 admin 전용으로 남는다.
 *    단, 사용자 관리 안에서 **역할 변경과 admin 계정 취급**은 여전히 admin 전용이다 —
 *    라우트 단위로는 표현할 수 없어 `@/lib/pageAccess` + `assertCanManageAccount` 가 맡고,
 *    `src/lib/__tests__/pageAccess.test.ts` 가 검사한다.
 */
import fs from 'fs';
import path from 'path';
import { PRODUCTION_RECORD_DELETE_ROLES, USER_MANAGEMENT_ROLES } from '@/lib/pageAccess';

const A = 'admin';
const AE = 'admin+engineer';
const AEO = 'admin+engineer+operator';
const NONE = 'NONE'; // 그 메서드에 requireUser 가 없음(405 스텁 등)

// route(디렉터리 경로) → { HTTP메서드: 정렬된 역할 문자열('+' 결합) 또는 'NONE' }
const POLICY: Record<string, Record<string, string>> = {
  'admin/machines': { GET: AE, POST: AE },
  'admin/machines/[machineId]': { PUT: AE, DELETE: AE },
  'admin/machines/bulk-upload': { POST: AE },
  'admin/machines/template': { GET: AE },
  // 최초 시스템 관리자 계정 생성 — 사용자 관리와 달리 등급을 만들어내는 부트스트랩이다.
  'admin/setup-real-user': { POST: A, GET: A },
  'admin/users': { GET: AE, POST: AE, DELETE: AE },
  'admin/users/[userId]': { PUT: AE, DELETE: AE },
  'alerts': { GET: AE, POST: AE },
  'auth/profile-admin': { GET: AEO },
  'downtime-analysis': { GET: AE },
  'downtime-entries': { POST: AEO, GET: AEO },
  'downtime-entries/[id]': { DELETE: AEO, PATCH: AEO },
  'machine-status-descriptions': { GET: AEO },
  'machines': { GET: AEO, POST: AE, DELETE: AE },
  'machines/[machineId]': { GET: AEO, PUT: AE, PATCH: AEO },
  'machines/[machineId]/downtime': { GET: AEO, PATCH: AEO, POST: AEO },
  'machines/[machineId]/oee': { GET: AEO },
  'machines/[machineId]/production': { GET: AEO },
  'model-processes': { GET: AEO, POST: AE },
  // 쓰기는 admin+engineer. 2026-08-04 감사 이후 마스터 편집이 브라우저 직접 쓰기에서
  // 이 API 로 옮겨 왔다 — 예전에는 RLS 만이 유일한 관문이었고 계정 활성 여부를 보지 않았다.
  'model-processes/[id]': { GET: AEO, PUT: AE, DELETE: AE },
  'oee-data': { GET: AEO },
  'oee-data/aggregated': { GET: AE },
  'oee-data/by-machine': { GET: AE },
  'product-models': { GET: AEO, POST: AE },
  'product-models/[id]': { GET: AEO, PUT: AE, DELETE: AE },
  'production-progress': { POST: AEO, GET: AEO },
  'production-records': { GET: AEO, POST: AEO },
  // DELETE 는 2026-07-31 부터 관리자도 한다 ('설정 제외 모든 페이지 CRUD'의 D).
  // 사용자(operator)는 읽기/쓰기/수정까지만이므로 여전히 제외된다.
  'production-records/[recordId]': { GET: AEO, PUT: AEO, DELETE: AE, PATCH: AEO },
  'production-records/[recordId]/defect': { PATCH: AEO },
  'production-records/close-shift': { POST: AEO },
  // 전사 마감 대기 큐(읽기 전용). 운영자도 본다 — 다만 라우트가 `assignedMachineIds` 로
  // 스코프를 좁히므로 남의 설비는 나오지 않는다. 마감 **쓰기**는 여전히 close-shift 하나뿐이다.
  'production-records/close-queue': { GET: AEO },
  'production-records/daily': { POST: AEO },
  'production-records/pending': { GET: AEO },
  'productivity-analysis': { GET: AE },
  'quality-analysis': { GET: AE },
  'system-settings': { GET: AEO, PUT: A, POST: A, DELETE: A },
  'system-settings/[category]': { GET: AEO, PUT: A, DELETE: A },
  'system-settings/service-role': { GET: AEO },
  'upload/image': { POST: A, GET: NONE }, // GET 은 405 스텁(작업 없음) → 인증 불필요
  'user-profiles': { GET: A },
};

// 파일 전체에 requireUser 가 없는 라우트 — 반드시 사유를 남긴다.
const EXEMPT: Record<string, string> = {
  'auth/login': '사전 인증 엔드포인트 (세션이 아직 없다)',
  'auth/logout': '사전/사후 인증 엔드포인트',
  'auth/profile': '자기 프로필 조회/수정 — 토큰 자체 검증',
  'system-settings/update': '인라인 관리자 검증 (Service Role 사용 전 role=admin + is_active 확인)',
};

const API_ROOT = path.join(__dirname, '..');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectRouteFiles(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}
function routeKey(file: string): string {
  return path.relative(API_ROOT, path.dirname(file)).split(path.sep).join('/');
}

/**
 * `requireUser` 를 감싼 헬퍼는 역할 배열이 소스에 안 보인다. 원장이 그걸 'NONE'(인증 없음)
 * 으로 읽으면, 실제로는 보호되는 라우트가 무방비로 기록되어 원장이 거짓말을 하게 된다.
 * 그래서 헬퍼 이름을 **실제 역할 목록에서 해석**한다 — 목록이 바뀌면 여기도 따라 바뀐다.
 */
const GUARD_HELPERS: Record<string, string> = {
  requireUserManager: [...USER_MANAGEMENT_ROLES].sort().join('+'),
};

/**
 * `requireUser(request, [...CONST])` 처럼 역할 목록을 상수에서 펼쳐 쓰는 라우트가 있다.
 * 소스 텍스트만 보면 `...PRODUCTION_RECORD_DELETE_ROLES` 라는 글자만 남아 원장과 비교할 수
 * 없다. 여기서 **실제 상수 값으로** 해석한다 — `GUARD_HELPERS` 와 같은 원리이고, 상수가
 * 바뀌면 이 테스트가 자동으로 새 값을 본다.
 *
 * 라우트가 역할을 다시 적지 않고 상수를 읽는 것은 권장되는 방향이므로(UI 와 API 가 같은
 * 규칙을 읽는다), 원장이 그걸 이해하지 못해서 상수 사용을 막는 일이 없어야 한다.
 */
const ROLE_CONSTANTS: Record<string, readonly string[]> = {
  PRODUCTION_RECORD_DELETE_ROLES,
  USER_MANAGEMENT_ROLES,
};

/** `'admin'` 같은 리터럴과 `...CONST` 스프레드를 모두 역할 이름 배열로 편다. */
function expandRoleTokens(raw: string): string[] {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .flatMap(token => {
      const spread = token.match(/^\.\.\.\s*(\w+)$/);
      if (spread) {
        const resolved = ROLE_CONSTANTS[spread[1]];
        // 모르는 상수를 조용히 무시하면 원장이 "역할 없음"으로 읽어 거짓 통과가 된다.
        if (!resolved) throw new Error(`ROLE_CONSTANTS 에 ${spread[1]} 이(가) 없습니다`);
        return [...resolved];
      }
      return [token.replace(/^['"]|['"]$/g, '')];
    });
}

/** 파일을 export 함수(메서드) 블록으로 잘라, 각 블록의 인가 검사 역할을 뽑는다. */
function extractByMethod(source: string): Record<string, string> {
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+(${METHODS.join('|')})\\b`, 'g');
  const marks: Array<{ method: string; idx: number }> = [];
  for (let m = re.exec(source); m !== null; m = re.exec(source)) marks.push({ method: m[1], idx: m.index });
  const result: Record<string, string> = {};
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].idx : source.length;
    const block = source.slice(marks[i].idx, end);

    const helper = Object.keys(GUARD_HELPERS).find(name =>
      new RegExp(`\\b${name}\\(\\s*request\\s*\\)`).test(block)
    );
    if (helper) {
      result[marks[i].method] = GUARD_HELPERS[helper];
      continue;
    }

    // 공장 인지 계약으로 전환된 메서드도 같은 원장에 들어간다.
    //
    // 역할 목록은 그대로이고 공장 경계가 **추가**된 것이므로, 원장의 역할 값은 바뀌지
    // 않아야 한다. 전환하면서 역할이 넓어지면 이 검사가 잡는다 — 경계를 하나 더하면서
    // 다른 하나를 느슨하게 푸는 것이 이행 중 가장 흔한 사고다.
    const fm = block.match(/requireFactoryUser\(\s*request\s*,\s*\[([^\]]*)\]/);
    if (fm) {
      result[marks[i].method] = expandRoleTokens(fm[1]).sort().join('+');
      continue;
    }

    const rm = block.match(/requireUser\(\s*request\s*,\s*\[([^\]]*)\]/);
    result[marks[i].method] = rm
      ? expandRoleTokens(rm[1]).sort().join('+')
      : NONE;
  }
  return result;
}

describe('API 라우트 권한 정책 원장 (메서드별)', () => {
  const files = collectRouteFiles(API_ROOT).filter(f => !f.includes('__tests__'));
  const actual = new Map<string, Record<string, string>>(
    files.map(f => [routeKey(f), extractByMethod(fs.readFileSync(f, 'utf8'))])
  );

  it('모든 라우트가 정책 원장(POLICY) 또는 예외 목록(EXEMPT)에 있다', () => {
    const unlisted = [...actual.keys()].filter(k => !(k in POLICY) && !(k in EXEMPT));
    expect(unlisted).toEqual([]);
  });

  it('각 (라우트, HTTP 메서드) 의 역할이 정책 원장과 정확히 일치한다', () => {
    const mismatches: string[] = [];
    for (const [route, methods] of Object.entries(POLICY)) {
      const got = actual.get(route);
      if (!got) { mismatches.push(`${route}: 라우트 파일 없음(정책 항목이 낡음)`); continue; }
      // 정책에 선언한 메서드가 실제와 다르면(역할 스왑 포함) 잡힌다.
      for (const [method, roles] of Object.entries(methods)) {
        if (got[method] !== roles) mismatches.push(`${route} ${method}: 기대 ${roles} ↔ 실제 ${got[method] ?? '없음'}`);
      }
      // 실제 파일에 있는데 정책에 없는 메서드도 잡는다(새 메서드 추가 시 정책 갱신 강제).
      for (const method of Object.keys(got)) {
        if (!(method in methods)) mismatches.push(`${route} ${method}: 정책 원장에 미등록(실제 ${got[method]})`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('예외 라우트는 어떤 메서드에도 requireUser 가 없다', () => {
    const problems: string[] = [];
    for (const route of Object.keys(EXEMPT)) {
      const got = actual.get(route);
      if (!got) { problems.push(`${route}: 예외 항목이 낡음(라우트 없음)`); continue; }
      for (const [method, roles] of Object.entries(got)) {
        if (roles !== NONE) problems.push(`${route} ${method}: requireUser 를 쓰기 시작함(${roles}) — POLICY 로 옮길 것`);
      }
    }
    expect(problems).toEqual([]);
  });
});
