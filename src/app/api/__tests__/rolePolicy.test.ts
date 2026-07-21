/**
 * API 라우트 권한 정책 원장(자체 감사 #6).
 *
 * 문제: 역할 배열이 30여 개 route.ts 에 손으로 박혀 있어 "엔지니어가 어디에 쓸 수 있나"
 * 같은 정책 질문에 전 라우트 grep 이 필요했고, 새 라우트가 정책 검토 없이 추가될 수 있었다.
 *
 * 이 테스트가 정책의 단일 원장이다:
 *  - 모든 route.ts 의 requireUser([...]) 역할 배열을 추출해 아래 POLICY 와 대조한다.
 *  - 라우트를 추가/변경하면 여기 정책 항목도 함께 갱신해야 한다(리뷰에서 정책 변경이 보인다).
 *  - requireUser 가 없는 라우트는 EXEMPT 에 사유와 함께 명시해야 한다.
 *
 * 정책 결정 기록: engineer 의 생산 데이터 쓰기 허용은 2026-07-20 사용자 확정
 * (CLAUDE.md 역할 정의 참조). 삭제·설정·사용자 관리는 admin 전용.
 */
import fs from 'fs';
import path from 'path';

const A = ['admin'];
const AE = ['admin', 'engineer'];
const AEO = ['admin', 'engineer', 'operator'];

// 라우트(src/app/api 이하 디렉터리 경로) → requireUser 호출들의 역할 배열(정렬된 다중집합).
const POLICY: Record<string, string[][]> = {
  'admin/machines': [A, A],
  'admin/machines/[machineId]': [A, A],
  'admin/machines/bulk-upload': [A],
  'admin/machines/template': [A],
  'admin/setup-real-user': [A, A],
  'admin/users': [A, A, A],
  'admin/users/[userId]': [A, A],
  'alerts': [AE, AE],
  'auth/profile-admin': [AEO],
  'downtime-analysis': [AE],
  'downtime-entries': [AEO, AEO],
  'downtime-entries/[id]': [AEO, AEO],
  'machine-status-descriptions': [AEO],
  'machines': [A, A, AEO],
  'machines/[machineId]': [A, AEO, AEO],
  'machines/[machineId]/downtime': [AEO],
  'machines/[machineId]/oee': [AEO],
  'machines/[machineId]/production': [AEO],
  'model-processes': [A, AEO],
  'model-processes/[id]': [AEO],
  'oee-data': [AEO],
  'oee-data/aggregated': [AE],
  'oee-data/by-machine': [AE],
  'product-models': [A, AEO],
  'product-models/[id]': [AEO],
  'production-progress': [AEO, AEO],
  'production-records': [AEO, AEO],
  'production-records/[recordId]': [A, AEO, AEO, AEO],
  'production-records/[recordId]/defect': [AEO],
  'production-records/close-shift': [AEO],
  'production-records/daily': [AEO],
  'production-records/pending': [AEO],
  'productivity-analysis': [AE],
  'quality-analysis': [AE],
  'system-settings': [A, A, A, AEO],
  'system-settings/[category]': [A, A, AEO],
  'system-settings/service-role': [AEO],
  'upload/image': [A],
  'user-profiles': [A],
};

// requireUser 를 쓰지 않는 라우트 — 반드시 사유를 남긴다.
const EXEMPT: Record<string, string> = {
  'auth/login': '사전 인증 엔드포인트 (세션이 아직 없다)',
  'auth/logout': '사전/사후 인증 엔드포인트',
  'auth/profile': '자기 프로필 조회 — 토큰 자체 검증',
  'system-settings/update': '인라인 관리자 검증 (Service Role 사용 전 role=admin + is_active 확인)',
};

const API_ROOT = path.join(__dirname, '..');

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

function extractRoleArrays(source: string): string[][] {
  const arrays: string[][] = [];
  const re = /requireUser\(\s*request\s*,\s*\[([^\]]*)\]/g;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    const roles = m[1]
      .split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .sort();
    arrays.push(roles);
  }
  // 파일 내 선언 순서와 무관하게 비교할 수 있도록 정렬한다.
  return arrays.sort((a, b) => a.join(',').localeCompare(b.join(',')));
}

describe('API 라우트 권한 정책 원장', () => {
  const files = collectRouteFiles(API_ROOT).filter(f => !f.includes('__tests__'));
  const actual = new Map<string, string[][]>(
    files.map(f => [routeKey(f), extractRoleArrays(fs.readFileSync(f, 'utf8'))])
  );

  it('모든 라우트가 정책 원장(POLICY) 또는 예외 목록(EXEMPT)에 있다', () => {
    const unlisted = [...actual.keys()].filter(k => !(k in POLICY) && !(k in EXEMPT));
    expect(unlisted).toEqual([]);
  });

  it('각 라우트의 역할 배열이 정책 원장과 일치한다', () => {
    const mismatches: string[] = [];
    for (const [route, expected] of Object.entries(POLICY)) {
      const got = actual.get(route);
      if (!got) { mismatches.push(`${route}: 라우트 파일 없음(정책 항목이 낡음)`); continue; }
      const norm = (v: string[][]) => JSON.stringify(v.map(a => [...a].sort()).sort((a, b) => a.join(',').localeCompare(b.join(','))));
      if (norm(got) !== norm(expected)) {
        mismatches.push(`${route}: 기대 ${norm(expected)} ↔ 실제 ${norm(got)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('예외 라우트는 실제로 requireUser 가 없고, 정책 라우트에는 있다', () => {
    const problems: string[] = [];
    for (const route of Object.keys(EXEMPT)) {
      const got = actual.get(route);
      if (!got) { problems.push(`${route}: 예외 항목이 낡음(라우트 없음)`); continue; }
      if (got.length > 0) problems.push(`${route}: requireUser 를 쓰기 시작함 — POLICY 로 옮길 것`);
    }
    for (const route of Object.keys(POLICY)) {
      const got = actual.get(route);
      if (got && got.length === 0) problems.push(`${route}: requireUser 호출이 사라짐 — 인증 누락?`);
    }
    expect(problems).toEqual([]);
  });
});
