import { inflateRawSync } from 'node:zlib';

export const MAX_FORECAST_BYTES = 4 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

export class ForecastInputError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 413 | 422 = 422) {
    super(code);
    this.name = 'ForecastInputError';
  }
}

/** Bound actual inflation before SheetJS sees the workbook. No extraction to disk. */
export function validateXlsxArchive(input: Buffer): void {
  if (input.length > MAX_FORECAST_BYTES) throw new ForecastInputError('file_too_large', 413);
  const bad = () => new ForecastInputError('invalid_xlsx');
  if (input.length < 22 || input.readUInt32LE(0) !== 0x04034b50) throw bad();
  let end = -1;
  for (let p = input.length - 22; p >= Math.max(0, input.length - 65557); p--) {
    if (input.readUInt32LE(p) === 0x06054b50 && p + 22 + input.readUInt16LE(p + 20) === input.length) {
      end = p; break;
    }
  }
  if (end < 0) throw bad();
  const count = input.readUInt16LE(end + 10);
  const centralSize = input.readUInt32LE(end + 12);
  const centralStart = input.readUInt32LE(end + 16);
  if (input.readUInt16LE(end + 4) || input.readUInt16LE(end + 6) ||
      input.readUInt16LE(end + 8) !== count || !count || count > 2048 ||
      centralStart + centralSize !== end) throw bad();
  let cursor = centralStart;
  let expanded = 0;
  const names = new Set<string>();
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || input.readUInt32LE(cursor) !== 0x02014b50) throw bad();
    const flags = input.readUInt16LE(cursor + 8);
    const method = input.readUInt16LE(cursor + 10);
    const compressedSize = input.readUInt32LE(cursor + 20);
    const size = input.readUInt32LE(cursor + 24);
    const nameSize = input.readUInt16LE(cursor + 28);
    const extraSize = input.readUInt16LE(cursor + 30);
    const commentSize = input.readUInt16LE(cursor + 32);
    const local = input.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameSize + extraSize + commentSize;
    if (next > end || (flags & 1) || ![0, 8].includes(method) || local + 30 > centralStart) throw bad();
    const name = input.subarray(cursor + 46, cursor + 46 + nameSize).toString('utf8');
    if (names.has(name) || name.includes('..') || name.includes('\\') || name.startsWith('/') || /vbaProject\.bin$/i.test(name)) throw bad();
    names.add(name);
    if (size > MAX_ENTRY_BYTES || expanded + size > MAX_EXPANDED_BYTES) throw new ForecastInputError('expanded_too_large', 413);
    if (input.readUInt32LE(local) !== 0x04034b50 || input.readUInt16LE(local + 6) !== flags || input.readUInt16LE(local + 8) !== method) throw bad();
    const localNameSize = input.readUInt16LE(local + 26);
    const start = local + 30 + localNameSize + input.readUInt16LE(local + 28);
    if (start + compressedSize > centralStart || input.subarray(local + 30, local + 30 + localNameSize).toString('utf8') !== name) throw bad();
    if (!(flags & 8) && (input.readUInt32LE(local + 18) !== compressedSize || input.readUInt32LE(local + 22) !== size)) throw bad();
    spans.push([local, start + compressedSize]);
    try {
      const compressed = input.subarray(start, start + compressedSize);
      const actual = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
      if (actual.length !== size) throw bad();
      expanded += actual.length;
    } catch (error) {
      if (error instanceof ForecastInputError) throw error;
      throw bad();
    }
    cursor = next;
  }
  spans.sort((a, b) => a[0] - b[0]);
  if (spans.some((span, i) => i > 0 && span[0] < spans[i - 1][1]) || cursor !== end ||
      !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) throw bad();
}
