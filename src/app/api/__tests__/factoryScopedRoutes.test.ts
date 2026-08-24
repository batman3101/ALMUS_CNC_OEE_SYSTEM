import fs from 'fs';
import path from 'path';

/**
 * 공장 범위 Route 원장.
 *
 * ## 지키려는 명제
 *
 * **공장 소유 테이블을 Service Role 로 만지는 Route 는 예외 없이 공장으로 제한한다.**
 *
 * RLS 는 브라우저의 직접 조회만 막는다. 이 앱은 Route 44개 중 40개가 Service Role 을
 * 쓰고, Service Role 은 RLS 를 **우회**한다. 그러니 DB 를 아무리 잘 나눠 놔도 Route 가
 * `factory_id` 를 걸지 않으면 분리는 없는 것과 같다.
 *
 * 실측(2026-08-24, 로컬 브라우저): 같은 계정으로 공장을 바꿔 가며 API 를 쳤더니
 *
 *   /api/machines           ALT=800  ALV=350   <- 전환됨
 *   /api/alerts             ALT=6    ALV=6     <- 같다
 *   /api/production-records ALT=4    ALV=4     <- 같다
 *   /api/product-models     ALT=2    ALV=2     <- 같다
 *
 * 대시보드 알림이 양쪽에서 똑같이 보인 이유가 이것이다.
 *
 * ## 왜 원장인가
 *
 * Route 26개를 손으로 고치면 반드시 빠뜨린다. 그리고 빠뜨린 Route 는 **조용히** 다른
 * 공장 데이터를 돌려준다 — 500 도, 로그도, 경고도 없다. 그래서 "고쳤다"를 세는 대신
 * "안 고친 것이 없다"를 세는 검사를 둔다.
 *
 * 새 Route 가 공장 소유 테이블을 만지기 시작하면 이 테스트를 고치지 않아도 자동으로
 * 검사 대상이 된다.
 */

const API_ROOT = path.join(process.cwd(), 'src/app/api');

/** 공장 제한의 형태는 하나로 고정한다 — 표기를 여러 개 허용하면 검사가 헐거워진다. */
const FACTORY_FILTER = /\.eq\('factory_id',/;

/** 공장 소유 테이블 (docs/workflows/D1_D2_INVENTORY_LEDGER.md 5절). */
const FACTORY_OWNED = [
  'machines',
  'machine_logs',
  'machine_status_history',
  'machine_status_descriptions',
  'downtime_entries',
  'production_records',
  'production_shift_states',
  'production_progress_reports',
  'product_models',
  'model_processes',
  'system_settings',
  'system_settings_audit',
  'alert_acknowledgements',
  'audit_log',
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

function routeKey(file: string): string {
  return path
    .relative(API_ROOT, path.dirname(file))
    .split(path.sep)
    .join('/');
}

/** SQL 주석·JS 주석 안의 테이블 이름이 원장에 섞이면 안 된다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 공장을 인자로 받지 **않는** RPC 들.
 *
 * 이 목록이 존재하는 이유: 2026-08-24 에 `.eq('factory_id', ...)` 만 세는 검사가
 * `productivity-analysis` 를 "전환됨"으로 통과시켰다. 그 파일은 어딘가에 그 필터를 하나
 * 갖고 있었지만, 정작 숫자를 만드는 `analytics_productivity` 에는 `p_machine_ids: null`
 * 을 넘겨 두 공장을 합쳐 집계하고 있었다.
 *
 * 존재를 세면 전수를 놓친다. 그래서 "공장을 모르는 RPC 를 부르는가"를 따로 센다.
 */
/**
 * 공장 소유 데이터를 담은 **뷰**.
 *
 * `machines_with_production_info` 는 tact time 의 출처이고 라우트 5곳이 설비 id 로 조회한다.
 * 원래 이 뷰에는 `factory_id` 컬럼이 아예 없어서 좁힐 수단이 없었다(20260824180000 에서 추가).
 * tact 는 OEE 의 분자이고 `production_records` 에 스냅샷으로 박히므로, 다른 공장 값으로
 * 계산된 성능은 나중에 고쳐도 그 행에 남는다.
 */
const FACTORY_OWNED_VIEWS = ['machines_with_production_info'] as const;

const FACTORY_BLIND_RPCS = [
  'analytics_oee_daily',
  'analytics_oee_by_machine',
  'analytics_oee_records_summary',
  'analytics_productivity',
  'analytics_quality',
  'update_system_setting',
  'update_system_settings_batch',
] as const;

/**
 * 이 뷰를 읽는 쿼리 **그 자체**에 공장 조건이 붙어 있는지 본다.
 *
 * "파일 어딘가에 .eq('factory_id', ...) 가 있다" 로는 부족하다. 그 형태의 검사가 바로
 * 2026-08-24 에 다섯 라우트를 통과시킨 결함이다 — 같은 파일의 **다른** 쿼리에 필터가
 * 있으면 통과했다. 실제로 mutation(뷰 쿼리의 필터만 제거)을 걸었을 때 검사가 통과했고,
 * 그래서 이 형태로 고쳤다.
 *
 * `from('view')` 부터 그 체인의 종단(maybeSingle/single/세미콜론)까지만 잘라서 본다.
 */
function viewQueryLacksFactory(source: string, view: string): boolean {
  const marker = `from('${view}')`;
  let cursor = source.indexOf(marker);
  while (cursor !== -1) {
    const rest = source.slice(cursor);
    // 체인의 끝. 어느 것이 먼저 오든 그 지점까지가 이 쿼리다.
    const end = Math.min(
      ...['maybeSingle(', 'single(', ';']
        .map(token => rest.indexOf(token))
        .filter(i => i !== -1)
        .concat([rest.length])
    );
    if (!FACTORY_FILTER.test(rest.slice(0, end))) return true;
    cursor = source.indexOf(marker, cursor + marker.length);
  }
  return false;
}

interface RouteFact {
  key: string;
  tables: string[];
  views: string[];
  usesServiceRole: boolean;
  usesFactoryAuth: boolean;
  scopesByFactory: boolean;
  blindRpcs: string[];
}

function analyze(): RouteFact[] {
  return collectRouteFiles(API_ROOT).map(file => {
    const raw = fs.readFileSync(file, 'utf8');
    const source = stripComments(raw);
    return {
      key: routeKey(file),
      tables: FACTORY_OWNED.filter(t => new RegExp(`from\\('${t}'\\)`).test(source)),
      views: FACTORY_OWNED_VIEWS.filter(v => viewQueryLacksFactory(source, v)),
      usesServiceRole: /supabase-admin/.test(source),
      usesFactoryAuth: /requireFactoryUser/.test(source),
      // 공장 제한의 형태는 하나로 고정한다 — 다양한 표기를 허용하면 검사가 헐거워진다.
      scopesByFactory: FACTORY_FILTER.test(source),
      // `rpc('analytics_quality'` 는 잡고 `rpc('analytics_quality_scoped'` 는 넘긴다.
      // 닫는 따옴표까지 봐야 접두사가 같은 새 이름이 걸리지 않는다.
      blindRpcs: FACTORY_BLIND_RPCS.filter(fn =>
        new RegExp(`rpc\\('${fn}'`).test(source)
      ),
    };
  });
}

describe('공장 범위 Route 원장', () => {
  const facts = analyze();
  const factoryTouching = facts.filter(f => f.tables.length > 0 && f.usesServiceRole);

  it('공장 소유 테이블을 만지는 Route 를 하나 이상 찾는다', () => {
    // 정규식이 깨져 0개를 찾으면 아래 검사들이 전부 공허하게 통과한다.
    expect(factoryTouching.length).toBeGreaterThan(5);
  });

  it('전환된 Route 는 requireFactoryUser 와 factory_id 필터를 함께 쓴다', () => {
    // 인가만 바꾸고 query 를 안 거는 것이 가장 위험하다 — 공장을 "알면서" 무시한다.
    const halfDone = factoryTouching
      .filter(f => f.usesFactoryAuth && !f.scopesByFactory)
      .map(f => f.key);

    expect(halfDone).toEqual([]);
  });

  it('공장 소유 테이블을 Service Role 로 만지는 Route 는 예외 없이 전환되어 있다', () => {
    // 2026-08-24 에 PENDING 목록이 비었다. 예외 목록이 없으므로 이 검사는 이제
    // **전수**다 — 새 Route 가 공장 소유 테이블을 만지기 시작하는 순간, 전환하지 않으면
    // 여기서 이름이 찍힌 채 실패한다. 목록을 손보지 않아도 자동으로 검사 대상이 된다.
    //
    // 예외를 다시 만들고 싶어지면, 그것은 "이 Route 만 공장 분리를 포기한다"는 뜻이다.
    // 조용히 통과시키는 대신 이 주석을 지우고 사유를 남겨라.
    const notConverted = factoryTouching
      .filter(f => !f.usesFactoryAuth)
      .map(f => f.key);

    expect(notConverted).toEqual([]);
  });

  it('공장을 모르는 RPC 를 부르는 Route 가 없다', () => {
    // RPC 는 `.from()` 정규식에 걸리지 않는다. 그래서 테이블을 직접 만지지 않고 RPC 로만
    // 집계하는 Route 는 위 검사들이 아예 보지 못했다 — 실제로 4개가 그렇게 숨어 있었다.
    // (oee-data/aggregated, oee-data/by-machine, system-settings/update,
    //  machines/[machineId]/downtime)
    //
    // 여기서는 factoryTouching 이 아니라 **전체 Route** 를 본다. 그것이 이 검사의 요점이다.
    const offenders = facts
      .filter(f => f.blindRpcs.length > 0)
      .map(f => `${f.key} -> ${f.blindRpcs.join(', ')}`);

    expect(offenders).toEqual([]);
  });

  it('공장 소유 뷰를 읽는 Route 는 공장으로 좁힌다', () => {
    // 뷰는 `FACTORY_OWNED`(테이블 목록)에 없으므로 위 검사들이 보지 못했다. 실제로 다섯
    // 라우트가 tact 를 설비 id 만으로 읽고 있었고, 그중 어느 것도 "미전환"으로 세어지지
    // 않았다 — 같은 파일의 다른 쿼리에는 공장 필터가 있었기 때문이다.
    // `views` 에 이름이 남아 있다는 것 자체가 "그 뷰 쿼리에 공장 조건이 없다"는 뜻이다.
    const offenders = facts
      .filter(f => f.views.length > 0)
      .map(f => `${f.key} -> ${f.views.join(', ')}`);

    expect(offenders).toEqual([]);
  });

  it('전환된 Route 수를 기록한다', () => {
    // 숫자가 줄면 누군가 Route 를 지웠거나 정규식이 헐거워진 것이다. 둘 다 알아야 한다.
    expect(factoryTouching.length).toBeGreaterThanOrEqual(28);
  });
});
