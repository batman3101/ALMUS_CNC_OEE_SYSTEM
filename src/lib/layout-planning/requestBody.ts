/** Tiny request-body guards for the layout-planning routes (the codebase does not use a schema library in routes). */
export class BadRequest extends Error {
  constructor(readonly code: string) { super(code); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export function uuid(v: unknown, code: string): string { if (!isUuid(v)) throw new BadRequest(code); return v; }
export function uuidOrNull(v: unknown, code: string): string | null { if (v === null) return null; return uuid(v, code); }
export function positiveInt(v: unknown, code: string): number { if (!Number.isInteger(v) || (v as number) < 1) throw new BadRequest(code); return v as number; }
export function text(v: unknown, code: string, max = 240): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new BadRequest(code);
  return v.trim();
}
export function array<T>(v: unknown, code: string, max: number, each: (item: unknown) => T): T[] {
  if (!Array.isArray(v) || v.length > max) throw new BadRequest(code);
  return v.map(each);
}
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new BadRequest('invalid_json'); }
}
