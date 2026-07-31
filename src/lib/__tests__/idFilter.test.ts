import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REST_IN_FILTER_MAX_IDS, chunkIdsForInFilter } from '../idFilter';

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8');

/**
 * `in.(...)` 필터는 URL 로 나간다. Supabase 게이트웨이의 한계는 실측 약 24 KiB 이고
 * (650개 24,125자 → 200 / 700개 25,975자 → 400), 이 프로젝트의 운영자는 전원 800대를
 * 배정받으므로 `id=in.(800개 UUID)` 는 항상 넘었다. 그래서 운영자에게
 * `/api/machines` 와 `/api/production-records` 가 **늘 500** 이었다.
 */
describe('chunkIdsForInFilter', () => {
  const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const ids = (n: number) => Array.from({ length: n }, (_, i) => uuid(i));

  it('빈 목록은 빈 배열 — 호출자가 "필터 없음"과 헷갈리지 않게 한다', () => {
    expect(chunkIdsForInFilter([])).toEqual([]);
  });

  it('한계 이하는 자르지 않는다', () => {
    const chunks = chunkIdsForInFilter(ids(REST_IN_FILTER_MAX_IDS));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(REST_IN_FILTER_MAX_IDS);
  });

  it('한계를 넘으면 나눈다', () => {
    expect(chunkIdsForInFilter(ids(REST_IN_FILTER_MAX_IDS + 1))).toHaveLength(2);
  });

  it('운영 값(800대)에서 모든 조각이 한계 이하다', () => {
    const chunks = chunkIdsForInFilter(ids(800));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(REST_IN_FILTER_MAX_IDS);
    }
  });

  it('조각을 합치면 원본과 같다 — 행이 사라지지 않는다', () => {
    const source = ids(800);
    expect(chunkIdsForInFilter(source).flat().sort()).toEqual([...source].sort());
  });

  it('조각끼리 서로소다 — 병합해도 행이 중복되지 않는다', () => {
    const chunks = chunkIdsForInFilter(ids(800));
    const seen = new Set<string>();
    for (const chunk of chunks) {
      for (const id of chunk) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });

  it('중복 아이디는 제거한다 — 그대로 두면 병합 결과에 같은 행이 두 번 들어온다', () => {
    expect(chunkIdsForInFilter(['a', 'b', 'a', 'b'])).toEqual([['a', 'b']]);
  });

  it('실측 한계보다 충분히 낮게 잡혀 있다', () => {
    // 경계는 650~700 사이였다. select 절 길이까지 감안해 여유를 크게 둔다.
    expect(REST_IN_FILTER_MAX_IDS).toBeLessThanOrEqual(300);
  });
});

/**
 * 규칙이 있어도 쓰지 않으면 소용없다. 담당 설비 목록을 그대로 `.in()` 에 넣는 코드가
 * 다시 생기는 것을 잡는다 — 이게 정확히 이번에 터진 모양이다.
 */
describe('담당 설비 목록을 자르지 않고 필터로 넘기지 않는다', () => {
  const SERVICE_ROLE_ROUTES = [
    'src/app/api/machines/route.ts',
    'src/app/api/production-records/route.ts',
    'src/app/api/oee-data/route.ts',
  ];

  it.each(SERVICE_ROLE_ROUTES)('%s 가 청크 헬퍼를 쓴다', (path) => {
    const source = read(path);
    expect(source).toContain('chunkIdsForInFilter');
    // `.in('...', user.assignedMachineIds)` 처럼 통째로 넘기는 형태가 남아 있으면 안 된다.
    expect(source).not.toMatch(/\.in\(\s*['"][^'"]+['"]\s*,\s*\w+\.assignedMachineIds\s*\)/);
  });

  /**
   * 브라우저 클라이언트는 반대다. `machines`·`machine_logs`·`production_records` 에
   * `Scoped read` RLS 정책이 있으므로 클라이언트가 같은 필터를 다시 붙이면 방어가
   * 두 겹이 되는 게 아니라 URL 만 길어져 **요청이 깨진다**.
   */
  it('실시간 훅이 담당 설비 목록으로 다시 좁히지 않는다 (RLS 가 건다)', () => {
    const source = read('src/hooks/useRealtimeData.ts');
    expect(source).not.toMatch(/\.in\(\s*['"]id['"]\s*,\s*assignedMachineIds\s*\)/);
    expect(source).not.toMatch(/\.in\(\s*['"]machine_id['"]\s*,\s*(assignedMachineIds|scopeIds)\s*\)/);
  });
});
