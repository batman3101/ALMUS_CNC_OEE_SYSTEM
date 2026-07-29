/**
 * 로그에 실어도 되는 모양으로 요청 본문을 가공한다.
 *
 * 왜 필요한가 — `/api/admin/users` POST 는 요청 본문을 통째로 `console.log` 했고, 그 본문에는
 * 관리자가 방금 입력한 **평문 비밀번호**가 들어 있었다. 계정을 만들 때마다 평문 비밀번호가
 * 애플리케이션 로그에 영구 기록됐다(Codex 감사 2026-07-29 HIGH #2).
 *
 * 그 한 곳만 고치지 않는 이유: 본문을 통째로 찍는 자리가 저장소에 네 군데 있었고, 지금은
 * 비밀이 없는 세 곳도 나중에 필드가 하나 늘면 같은 사고가 난다. "본문을 찍지 말자" 는 규율은
 * 사람이 매번 기억해야 하지만, "본문은 항상 지워서 찍는다" 는 규율은 이 함수가 대신 기억한다.
 *
 * 키 이름으로 판단한다 — 값의 모양으로는 비밀 여부를 알 수 없기 때문이다. 부분 일치(소문자
 * 비교)라 `password`, `newPassword`, `password_confirm` 이 모두 걸린다.
 */

const SECRET_KEY_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'credential',
  'authorization',
  'service_role',
];

const REDACTED = '[REDACTED]';

/** 순환 참조가 있는 객체도 스택 오버플로 없이 처리한다(요청 본문에는 드물지만 공짜다). */
const CIRCULAR = '[Circular]';

function isSecretKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return SECRET_KEY_PATTERNS.some(pattern => lowered.includes(pattern));
}

/**
 * 비밀로 보이는 키의 값을 `[REDACTED]` 로 바꾼 **새 객체**를 돌려준다.
 * 입력은 절대 변경하지 않는다 — 로깅이 요청 처리에 영향을 주면 안 된다.
 */
export function redactSecrets(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value as object)) return CIRCULAR;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map(item => redactSecrets(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSecretKey(key) ? REDACTED : redactSecrets(item, seen);
  }
  return result;
}
