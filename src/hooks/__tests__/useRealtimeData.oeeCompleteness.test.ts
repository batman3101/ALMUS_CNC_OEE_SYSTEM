import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/authFetch', () => ({
  authFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

import { toOeeMetrics } from '../useRealtimeData';
import type { ProductionRecord } from '@/types';

const record = (overrides: Partial<ProductionRecord> = {}): ProductionRecord => ({
  record_id: 'r1',
  machine_id: 'm1',
  date: '2026-07-15',
  shift: 'A',
  planned_runtime: 660,
  actual_runtime: 640,
  ideal_runtime: 600,
  output_qty: 100,
  defect_qty: 1,
  availability: 0.97,
  performance: 0.9375,
  quality: 0.99,
  oee: 0.9,
  ...overrides,
} as ProductionRecord);

describe('toOeeMetrics: 미보고를 0% 로 둔갑시키지 않는다', () => {
  it('계산 가능한 실적은 저장된 값을 그대로 쓴다', () => {
    expect(toOeeMetrics(record())).toEqual({
      availability: 0.97,
      performance: 0.9375,
      quality: 0.99,
      oee: 0.9,
      actual_runtime: 640,
      planned_runtime: 660,
      ideal_runtime: 600,
      output_qty: 100,
      defect_qty: 1,
    });
  });

  // /api/oee-data 는 toNullableNumber 로 NULL 을 보존해서 내려준다
  // (oee-data/__tests__/completenessContract.test.ts 가 고정). 그 NULL 을 여기서
  // `|| 0` 으로 뭉개면 라우트가 지킨 구분이 한 겹 위에서 사라진다.
  it.each([
    ['availability', { availability: null }],
    ['performance', { performance: null }],
    ['quality', { quality: null }],
    ['oee', { oee: null }],
    ['planned_runtime', { planned_runtime: null }],
    ['actual_runtime', { actual_runtime: null }],
    ['ideal_runtime', { ideal_runtime: null }],
  ])('%s 가 NULL 이면 지표를 만들지 않는다 (null 반환)', (_field, patch) => {
    expect(toOeeMetrics(record(patch as Partial<ProductionRecord>))).toBeNull();
  });

  // 확인된 무생산 교대는 진짜 0 이다. NULL 과 달리 숨기면 안 된다.
  it('확인된 0 은 0 으로 남긴다 (NULL 과 구분)', () => {
    const zero = toOeeMetrics(record({
      output_qty: 0, defect_qty: 0, actual_runtime: 0, ideal_runtime: 0,
      availability: 0, performance: 0, quality: 0, oee: 0,
    }));
    expect(zero).not.toBeNull();
    expect(zero!.oee).toBe(0);
    expect(zero!.planned_runtime).toBe(660);
  });

  it('계획 가동시간을 480 으로 지어내지 않는다', () => {
    // 교대 기본 계획시간은 660분(12시간 − 60분 휴식)이다. 480 은 어디에서도
    // 근거가 없는 값이었다.
    expect(toOeeMetrics(record({ planned_runtime: 660 }))!.planned_runtime).toBe(660);
    expect(toOeeMetrics(record({ planned_runtime: null }))).toBeNull();
  });
});

// 소스 계약은 코드만 봐야 한다. 주석에 "예전에는 record.oee || 0 이었다" 라고 적으면
// 그 설명 문구 자체가 금지 패턴에 걸린다 (실제로 걸렸다). 주석을 지우고 검사한다.
const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('useRealtimeData 소스 계약', () => {
  const source = stripComments(readFileSync(
    resolve(process.cwd(), 'src/hooks/useRealtimeData.ts'),
    'utf8'
  ));

  it('실적이 없는 설비에 0%/480분 지표를 지어내지 않는다', () => {
    expect(source).not.toMatch(/createEmptyOeeMetrics/);
    expect(source).not.toMatch(/planned_runtime:\s*480/);
    expect(source).not.toMatch(/record\.oee\s*\|\|\s*0/);
    expect(source).not.toMatch(/record\.planned_runtime\s*\|\|\s*480/);
  });

  // 엔지니어 화면은 이 훅에서 machines 만 쓴다. 그런데도 1.9MB(4,052행)를 받아
  // 전부 버리면서 loading 을 붙잡고 있었다 (2026-07-17 실측: 그 요청 1건이 3~4초).
  it('생산 실적 조회를 옵션으로 끌 수 있다', () => {
    expect(source).toMatch(/includeProductionRecords/);
    // 끈 경우 oeeMetrics 는 {} 가 아니라 null 이어야 한다. {} 는 "설비별 지표가
    // 하나도 없다"로 읽혀 다시 0% 표시로 이어진다.
    expect(source).toMatch(/oeeMetrics:\s*Record<string,\s*OEEMetrics>\s*\|\s*null/);
  });
});

describe('EngineerDashboard 소스 계약', () => {
  const source = stripComments(readFileSync(
    resolve(process.cwd(), 'src/components/dashboard/EngineerDashboard.tsx'),
    'utf8'
  ));

  it('쓰지도 않는 생산 실적을 받아오지 않는다', () => {
    expect(source).toMatch(/includeProductionRecords:\s*false/);
  });
});
