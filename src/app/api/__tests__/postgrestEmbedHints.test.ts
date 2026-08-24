import fs from 'fs';
import path from 'path';

/**
 * PostgREST 임베드는 **제약 이름**으로 지목한다 — 컬럼 이름으로 지목하지 않는다.
 *
 * ## 왜 이 검사가 있나
 *
 * 다중화가 각 자식 테이블에 복합 FK `(factory_id, parent_id) -> parent(factory_id, id)` 를
 * 추가하면서, 기존 단일 컬럼 FK 와 **관계가 두 개**가 됐다. 그 상태에서 컬럼 힌트로 임베드하면
 * PostgREST 가 어느 쪽인지 몰라 실패한다:
 *
 *   PGRST201  Could not embed because more than one relationship was found
 *
 * 그래서 단일 FK 를 지웠다(20260824120000). 그러자 이번엔 **컬럼 힌트가 해석되지 않는다**:
 *
 *   PGRST200  Could not find a relationship between 'X' and 'col' in the schema cache
 *
 * 즉 컬럼 힌트는 FK 를 남겨도 지워도 깨진다. 제약 이름으로 지목하는 형태만 양쪽 다 안전하다.
 *
 * ## 왜 원장이 필요한가
 *
 * 이 결함은 **세 번 재발했다**:
 *   1. `machines!inner(...)` 임베드 10곳 (PGRST201, 전면 500)
 *   2. `product_models:production_model_id` 등 4파일 (PGRST200)
 *   3. `product_models:model_id` 1곳 — 위 둘을 고치고도 남아 있었다.
 *      2026-08-24 브라우저 UI 검증에서 "설비 정보 로드에 실패했습니다"로 드러났다.
 *
 * 세 번 다 **런타임에만** 드러난다. 타입 검사도 lint 도 테스트도 통과한다 — 문자열 안의
 * 쿼리이기 때문이다. 그래서 문자열을 직접 본다.
 */

const API_ROOT = path.join(process.cwd(), 'src/app/api');

/** 공장 다중화로 복합 FK 가 생긴 부모 테이블들. 이 이름으로 임베드하는 곳이 대상이다. */
const FACTORY_SCOPED_PARENTS = [
  'machines',
  'product_models',
  'model_processes',
  'system_settings',
] as const;

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...collectRouteFiles(full));
    } else if (entry.name === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

/**
 * `parent:something (` 형태의 임베드 별칭을 모은다.
 *
 * 안전한 형태는 `parent:parent!constraint_name (` 이다 — 별칭 뒤가 `!` 를 포함한다.
 * 위험한 형태는 `parent:column_name (` — 컬럼으로 관계를 지목한다.
 */
function unsafeEmbeds(source: string): string[] {
  const found: string[] = [];
  for (const parent of FACTORY_SCOPED_PARENTS) {
    // `parent:` 뒤에 오는 토큰을 본다. 여는 괄호 전까지가 힌트다.
    const re = new RegExp(`${parent}\\s*:\\s*([A-Za-z0-9_!]+)\\s*\\(`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const hint = m[1];
      // 제약 이름으로 지목했으면 안전하다.
      if (hint.includes('!')) continue;
      found.push(`${parent}:${hint}`);
    }
  }
  return found;
}

describe('PostgREST 임베드 원장', () => {
  const files = collectRouteFiles(API_ROOT);

  it('Route 파일을 하나 이상 찾는다', () => {
    // 정규식이나 경로가 깨져 0개를 찾으면 아래 검사가 공허하게 통과한다.
    expect(files.length).toBeGreaterThan(20);
  });

  it('공장 소유 부모를 컬럼 이름으로 임베드하지 않는다', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const bad of unsafeEmbeds(source)) {
        offenders.push(`${path.relative(API_ROOT, file)}: ${bad}`);
      }
    }

    // 컬럼 힌트는 관계가 하나든 둘이든 깨진다(PGRST200 / PGRST201).
    // 제약 이름으로 지목하는 형태(`parent:parent!constraint`)만 양쪽 다 안전하다.
    expect(offenders).toEqual([]);
  });

  it('제약 이름 형태의 임베드가 실제로 쓰이고 있다', () => {
    // 위 검사가 "임베드가 아예 없어서" 통과하는 상황을 배제한다.
    const withConstraintHints = files.filter(f =>
      /![a-z_]+_fkey\s*\(/.test(fs.readFileSync(f, 'utf8'))
    );
    expect(withConstraintHints.length).toBeGreaterThan(0);
  });
});
