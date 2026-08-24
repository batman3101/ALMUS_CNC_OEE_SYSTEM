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

/**
 * 아직 전환하지 않은 Route.
 *
 * **이 목록은 줄어들기만 해야 한다.** 항목을 지울 때마다 그 Route 가 공장으로 제한된다.
 * 새 Route 를 여기 추가하는 것은 "공장 분리를 포기한다"는 뜻이므로, 추가하려면 그 이유를
 * 옆에 적어야 한다.
 *
 * 비어 있게 되면 이 배열과 아래 두 번째 테스트를 함께 지운다.
 */
const PENDING: Record<string, string> = {
  'admin/machines/[machineId]': '설비 관리 — 전환 예정',
  'admin/machines/bulk-upload': '설비 일괄 등록 — 전환 예정',
  'admin/machines': '설비 관리 — 전환 예정',
  'downtime-analysis': '분석 — 전환 예정',
  'oee-data': 'OEE 조회 — 전환 예정',
  'production-records': '생산기록 목록 — 전환 예정',
  'system-settings/service-role': '설정 서비스롤 조회 — 전환 예정',
  'downtime-entries/[id]': '비가동 — 전환 예정',
  'downtime-entries': '비가동 — 전환 예정',
  'machines/[machineId]/oee': '설비 OEE — 전환 예정',
  'machines/[machineId]/production': '설비 생산 — 전환 예정',
  'machines/[machineId]': '설비 단건 — 전환 예정',
  'machine-status-descriptions': '상태 설명 — 전환 예정',
  'model-processes/[id]': '공정 — 전환 예정',
  'model-processes': '공정 — 전환 예정',
  'production-progress': '진척 — 전환 예정',
  'production-records/[recordId]/defect': '불량 확정 — 전환 예정',
  'production-records/[recordId]': '생산기록 단건 — 전환 예정',
  'production-records/close-queue': '마감 대기 — 전환 예정',
  'production-records/close-shift': '교대 마감 — 전환 예정',
  'production-records/daily': '일일 생산 — 전환 예정',
  'production-records/pending': '대기 목록 — 전환 예정',
  'productivity-analysis': '분석 — 전환 예정',
  'product-models/[id]': '모델 — 전환 예정',
  'product-models': '모델 — 전환 예정',
  'quality-analysis': '분석 — 전환 예정',
};

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

interface RouteFact {
  key: string;
  tables: string[];
  usesServiceRole: boolean;
  usesFactoryAuth: boolean;
  scopesByFactory: boolean;
}

function analyze(): RouteFact[] {
  return collectRouteFiles(API_ROOT).map(file => {
    const raw = fs.readFileSync(file, 'utf8');
    const source = stripComments(raw);
    return {
      key: routeKey(file),
      tables: FACTORY_OWNED.filter(t => new RegExp(`from\\('${t}'\\)`).test(source)),
      usesServiceRole: /supabase-admin/.test(source),
      usesFactoryAuth: /requireFactoryUser/.test(source),
      // 공장 제한의 형태는 하나로 고정한다 — 다양한 표기를 허용하면 검사가 헐거워진다.
      scopesByFactory: /\.eq\('factory_id',/.test(source),
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

  it('아직 전환하지 않은 Route 는 PENDING 에 사유와 함께 기록되어 있다', () => {
    const unlisted = factoryTouching
      .filter(f => !f.usesFactoryAuth && !(f.key in PENDING))
      .map(f => f.key);

    // 새 Route 가 공장 소유 테이블을 만지면서 전환도 안 하고 목록에도 없으면 여기서 걸린다.
    expect(unlisted).toEqual([]);
  });

  it('PENDING 에 남아 있는 항목은 실제로 미전환이다', () => {
    // 전환을 끝내고 목록에서 지우는 것을 잊으면, 그 항목이 다음 사람에게 "아직 안 됐다"고
    // 거짓말한다. 원장이 현실과 어긋나는 순간 원장으로서의 가치가 사라진다.
    const stale = Object.keys(PENDING).filter(key => {
      const fact = facts.find(f => f.key === key);
      return !fact || fact.usesFactoryAuth;
    });

    expect(stale).toEqual([]);
  });

  it('전환 진척을 기록한다', () => {
    const done = factoryTouching.filter(f => f.usesFactoryAuth).length;
    const total = factoryTouching.length;
    // 실패시키지 않는다 — 진척은 검사 대상이 아니라 관찰 대상이다.
    // 다만 숫자를 남겨 두면 리뷰에서 "얼마나 남았나"를 매번 세지 않아도 된다.
    expect(done).toBeGreaterThanOrEqual(1);
    expect(total).toBeGreaterThanOrEqual(done);
  });
});
