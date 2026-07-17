import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 함수 실행 리전은 DB 와 같은 곳이어야 한다.
 *
 * Vercel 의 기본 리전은 `iad1`(워싱턴DC)이고, 그 이유는 공식 문서에 "대부분의 외부
 * 데이터 소스가 미국 동부에 있으므로"라고 적혀 있다. **이 프로젝트는 그 가정이 틀리다.**
 * Supabase 프로젝트(wmtkkefsorrdlzprhlpr)는 `ap-southeast-1`(싱가포르)이고 사용자는
 * 베트남이다. 아무도 iad1 을 고른 적이 없었다 — vercel.json 이 없어서 기본값이었을 뿐이다.
 *
 * 그 결과 (2026-07-17 실측, x-vercel-id: `hkg1::iad1::...`):
 *   사용자(아시아) → 미국 동부(함수) → 싱가포르(DB) 왕복 3회 → 미국 → 사용자
 *   즉 요청 1건이 태평양을 4번 이상 건넜다.
 *   - `limit=1&include_statistics=false` (왕복 3회): 최저 1,302ms — 1KB 응답인데도!
 *   - `limit=1&include_statistics=true`  (왕복 4회): 최저 1,583ms
 *   - **왕복 1회 추가 = +281ms** (대조군: 아시아→싱가포르 직접 62ms)
 *
 * 왕복이 3회 이상인 이유는 requireUser(src/lib/apiAuth.ts)가 auth.getUser 와
 * user_profiles 조회를 **순차로** 하고, 모든 라우트가 자기 쿼리 전에 이걸 부르기 때문이다.
 *
 * `sin1` = ap-southeast-1 = Supabase 와 **동일한 AWS 리전**이다. "가깝다"가 아니라 같다.
 *
 * hkg1(홍콩)이 하노이에서 지리적으로 더 가깝지만 오답이다:
 *   사용자 거리는 요청당 1회, DB 거리는 3회 이상 지불한다. hkg1 은 사용자에서 ~15ms 를
 *   벌고 DB 왕복에서 ~100ms 를 잃는다.
 */
describe('Vercel 함수 리전 계약', () => {
  const raw = readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8');
  const config = JSON.parse(raw) as Record<string, unknown>;

  it('함수는 Supabase 와 같은 리전(sin1 = ap-southeast-1)에서 실행한다', () => {
    expect(config.regions).toEqual(['sin1']);
  });

  it('미국 리전으로 되돌아가지 않는다', () => {
    const regions = config.regions as string[];
    // iad1 은 Vercel 기본값이다. 명시적으로 고르지 않으면 여기로 돌아온다.
    for (const region of regions) {
      expect(region).not.toMatch(/^(iad|sfo|pdx|cle|yul)\d$/);
    }
  });

  /**
   * vercel.json 에 `builds` 가 있으면 대시보드의 빌드 설정을 통째로 덮어쓴다.
   * 이 파일은 리전만 지정하려고 만든 것이므로 빌드 파이프라인을 건드리면 안 된다.
   */
  it('빌드 설정을 덮어쓰지 않는다', () => {
    expect(config).not.toHaveProperty('builds');
    expect(config).not.toHaveProperty('buildCommand');
    expect(config).not.toHaveProperty('outputDirectory');
  });

  it('스키마를 선언해 오타를 에디터가 잡게 한다', () => {
    expect(config.$schema).toBe('https://openapi.vercel.sh/vercel.json');
  });
});
