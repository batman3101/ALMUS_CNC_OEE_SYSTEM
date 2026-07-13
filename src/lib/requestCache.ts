/**
 * GET 요청 중복 제거 유틸.
 *
 * 같은 URL에 대해
 *  1) in-flight 중복 제거: 이미 진행 중인 요청이 있으면 그 Promise 를 재사용한다.
 *  2) 짧은 TTL 캐시: TTL 안에서는 마지막 응답을 재사용한다.
 *
 * 서로 다른 컴포넌트/훅이 같은 분석 데이터를 각자 조회해 동일 요청이 중복되는 것을 막는다.
 * (예: EngineerDashboard 의 useEngineerData 와 OEE 추이 차트의 useOEEChartData 가
 *  동일한 /api/productivity-analysis?analysis_type=summary 를 각각 호출하던 문제)
 */
const DEFAULT_TTL_MS = 5_000;

interface CacheEntry {
  fetchedAt: number;
  data: unknown;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

async function requestJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${url} (${response.status})`);
  }
  return response.json();
}

/**
 * 같은 URL 의 동시/연속 GET 요청을 하나로 합친다.
 * @param ttlMs 캐시 유지 시간(ms). 0 이면 캐시 없이 in-flight 중복 제거만 적용한다.
 */
export function fetchJsonDeduped<T>(url: string, ttlMs: number = DEFAULT_TTL_MS): Promise<T> {
  const cached = cache.get(url);
  if (ttlMs > 0 && cached && Date.now() - cached.fetchedAt < ttlMs) {
    return Promise.resolve(cached.data as T);
  }

  const pending = inFlight.get(url);
  if (pending) {
    return pending as Promise<T>;
  }

  const request = requestJson(url)
    .then(data => {
      if (ttlMs > 0) {
        cache.set(url, { fetchedAt: Date.now(), data });
      }
      return data;
    })
    .finally(() => {
      inFlight.delete(url);
    });

  inFlight.set(url, request);
  return request as Promise<T>;
}

/** 저장된 응답을 모두 비운다 (수동 새로고침 등에서 사용). */
export function clearRequestCache(): void {
  cache.clear();
}
