// Supabase 조인 결과 처리 유틸리티
//
// PostgREST는 to-one 관계(`machines!inner(name, ...)`)를 런타임에는 **객체**로 반환하지만,
// 생성된 타입에서는 FK가 unique로 인식되지 않으면 **배열**로 추론된다.
// 그 결과 `record.machines?.name` 같은 코드가 TS2339로 실패한다.
//
// 아래 헬퍼는 두 형태(객체 / 배열)를 모두 안전하게 단일 값으로 풀어준다.

/** to-one 조인 결과가 객체 또는 배열 중 어느 쪽으로도 올 수 있음을 표현한다. */
export type Joined<T> = T | T[] | null | undefined;

/** `Joined<T>`(또는 생성된 `T[]` 타입)에서 실제 요소 타입을 추출한다. */
export type UnwrapJoined<T> = T extends readonly (infer U)[] ? U : NonNullable<T>;

/**
 * Supabase to-one 조인 결과를 단일 값으로 풀어준다.
 * 배열이면 첫 번째 요소를, 객체면 그대로, 비어 있으면 undefined를 반환한다.
 *
 * @example
 * // 이전 (TS2339: Property 'name' does not exist on type '{ name: any }[]')
 * const machineName = record.machines?.name;
 *
 * // 이후
 * import { unwrapJoin } from '@/types';
 * const machineName = unwrapJoin(record.machines)?.name;
 */
export function unwrapJoin<T>(value: T): UnwrapJoined<T> | undefined {
  if (value === null || value === undefined) return undefined;
  const unwrapped = Array.isArray(value) ? value[0] : value;
  return unwrapped as UnwrapJoined<T> | undefined;
}
