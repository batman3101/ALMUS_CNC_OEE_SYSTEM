/**
 * 원시 행을 돌려주는 API 라우트의 공통 페이지네이션 규칙.
 *
 * PostgREST 는 max-rows 상한(이 프로젝트는 100,000)을 강제한다.
 * .limit()/.range() 없이 그보다 많은 행에 매칭되는 select() 는
 * 정확히 100,000행만, 200 응답으로, 아무 경고 없이 돌려준다.
 * 응답만 봐서는 전부인지 잘린 건지 알 수 없다는 것이 핵심 문제였다.
 * (production_records 는 약 325,000행이라 연간 조회가 정확히 여기에 걸렸다.)
 *
 * 그래서 원시 행을 돌려주는 라우트는
 *   1) 명시적 상한을 두고(PostgREST 상한에 닿기 한참 전에 멈춘다)
 *   2) total / has_more 를 응답에 실어 경계를 "보이게" 만든다.
 * 보이지 않는 절삭은 정확성 버그지만, 보이는 절삭은 그냥 페이지다.
 */
export const DEFAULT_PAGE_LIMIT = 1_000;
export const MAX_PAGE_LIMIT = 5_000;

/** 숫자 쿼리 파라미터를 안전하게 파싱한다. 잘못된 값은 fallback 으로 접는다. */
export function parseIntParam(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export interface PaginationMeta {
  limit: number;
  offset: number;
  returned: number;
  total: number;
  has_more: boolean;
}

/** 응답에 실을 페이지네이션 메타데이터를 만든다. */
export function buildPaginationMeta(
  limit: number,
  offset: number,
  returned: number,
  total: number
): PaginationMeta {
  return {
    limit,
    offset,
    returned,
    total,
    has_more: offset + returned < total,
  };
}
