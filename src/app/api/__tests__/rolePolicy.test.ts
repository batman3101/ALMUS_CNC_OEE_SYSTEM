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
 * 정책 결정 기록: engineer 의 생산 데이터 쓰기 허용은 2026-07-20 사용자 확정(CLAUDE.md).
 * 삭제·설정·사용자 관리는 admin 전용.
 */
import fs from 'fs';
import path from 'path';

const A = 'admin';
const AE = 'admin+engineer';
const AEO = 'admin+engineer+operator';
const NONE = 'NONE'; // 그 메서드에 requireUser 가 없음(405 스텁 등)

// route(디렉터리 경로) → { HTTP메서드: 정렬된 역할 문자열('+' 결합) 또는 'NONE' }
const POLICY: Record<string, Record<string, string>> = {
  'admin/machines': { GET: A, POST: A },
  'admin/machines/[machineId]': { PUT: A, DELETE: A },
  'admin/machines/bulk-upload': { POST: A },
  'admin/machines/template': { GET: A },
  'admin/setup-real-user': { POST: A, GET: A },
  'admin/users': { GET: A, POST: A, DELETE: A },
  'admin/users/[userId]': { PUT: A, DELETE: A },
  'alerts': { GET: AE, POST: AE },
  'auth/profile-admin': { GET: AEO },
  'downtime-analysis': { GET: AE },
  'downtime-entries': { POST: AEO, GET: AEO },
  'downtime-entries/[id]': { DELETE: AEO, PATCH: AEO },
  'machine-status-descriptions': { GET: AEO },
  'machines': { GET: AEO, POST: A, DELETE: A },
  'machines/[machineId]': { GET: AEO, PUT: A, PATCH: AEO },
  'machines/[machineId]/downtime': { POST: AEO },
  'machines/[machineId]/oee': { GET: AEO },
  'machines/[machineId]/production': { GET: AEO },
  'model-processes': { GET: AEO, POST: A },
  'model-processes/[id]': { GET: AEO },
  'oee-data': { GET: AEO },
  'oee-data/aggregated': { GET: AE },
  'oee-data/by-machine': { GET: AE },
  'product-models': { GET: AEO, POST: A },
  'product-models/[id]': { GET: AEO },
  'production-progress': { POST: AEO, GET: AEO },
  'production-records': { GET: AEO, POST: AEO },
  'production-records/[recordId]': { GET: AEO, PUT: AEO, DELETE: A, PATCH: AEO },
  'production-records/[recordId]/defect': { PATCH: AEO },
  'production-records/close-shift': { POST: AEO },
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

/** 파일을 export 함수(메서드) 블록으로 잘라, 각 블록의 requireUser 역할을 뽑는다. */
function extractByMethod(source: string): Record<string, string> {
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+(${METHODS.join('|')})\\b`, 'g');
  const marks: Array<{ method: string; idx: number }> = [];
  for (let m = re.exec(source); m !== null; m = re.exec(source)) marks.push({ method: m[1], idx: m.index });
  const result: Record<string, string> = {};
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].idx : source.length;
    const block = source.slice(marks[i].idx, end);
    const rm = block.match(/requireUser\(\s*request\s*,\s*\[([^\]]*)\]/);
    result[marks[i].method] = rm
      ? rm[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort().join('+')
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
