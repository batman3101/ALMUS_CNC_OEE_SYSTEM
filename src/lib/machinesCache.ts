import { Machine } from '@/types';

/**
 * `/api/machines` 공용 캐시.
 *
 * 설비 목록은 여러 곳(대시보드, 알림 컨텍스트, 보고서 페이지)에서 동시에 필요하지만
 * 페이지당 여러 번 내려받을 이유가 없다. 아래 두 가지로 중복 호출을 제거한다.
 *  1) in-flight 중복 제거: 동시에 들어온 요청은 같은 Promise를 공유한다.
 *  2) 짧은 TTL 캐시: TTL 안에서는 마지막 응답을 재사용한다.
 *
 * 최신 설비 상태가 반드시 필요한 경우(새로고침 버튼 등)에는 `{ force: true }`로
 * TTL을 우회한다. 이때도 in-flight 중복 제거는 그대로 적용된다.
 */
const CACHE_TTL_MS = 30_000;

interface MachinesCacheEntry {
  machines: Machine[];
  fetchedAt: number;
}

let cache: MachinesCacheEntry | null = null;
let inFlight: Promise<Machine[]> | null = null;

async function requestMachines(): Promise<Machine[]> {
  const response = await fetch('/api/machines', {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch machines: HTTP ${response.status}`);
  }

  const data: unknown = await response.json();

  if (Array.isArray(data)) {
    return data as Machine[];
  }

  const machines = (data as { machines?: Machine[] })?.machines;
  return machines ?? [];
}

export function fetchMachines(options?: { force?: boolean }): Promise<Machine[]> {
  if (!options?.force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve(cache.machines);
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = requestMachines()
    .then(machines => {
      cache = { machines, fetchedAt: Date.now() };
      return machines;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function invalidateMachinesCache(): void {
  cache = null;
}
