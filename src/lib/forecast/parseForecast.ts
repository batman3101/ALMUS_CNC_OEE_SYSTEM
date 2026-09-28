import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import type { ForecastPreview, ForecastQuantity, ForecastSourceRow } from '@/types/forecast';
import { ForecastInputError, validateXlsxArchive } from './xlsxArchive';

const cellAt = (sheet: XLSX.WorkSheet, row: number, col: number): XLSX.CellObject | undefined => sheet[XLSX.utils.encode_cell({ r: row, c: col })];
const text = (cell: XLSX.CellObject | undefined) => typeof cell?.v === 'string' ? cell.v.trim() : '';

function mergedLabel(sheet: XLSX.WorkSheet, row: number, col: number): string {
  const merge = sheet['!merges']?.find(m => m.s.c === col && m.e.c === col && m.s.r <= row && m.e.r >= row);
  return text(cellAt(sheet, merge?.s.r ?? row, col));
}

function quantity(cell: XLSX.CellObject | undefined, date: string, address: string): ForecastQuantity {
  const base = { date, cell: address, quantity: null, formula: Boolean(cell?.f), error: null };
  if (cell?.t === 'e') return { ...base, state: 'error', error: cell.w || String(cell.v) };
  if (cell?.f && (cell.v === undefined || cell.v === null || cell.t === 'z')) return { ...base, state: 'missing_cache' };
  if (!cell || cell.v === undefined || cell.v === null || cell.t === 'z' || cell.v === '') return { ...base, state: 'blank' };
  if (cell.t !== 'n' || typeof cell.v !== 'number' || !Number.isFinite(cell.v) || cell.v < 0 || cell.v > Number.MAX_SAFE_INTEGER) return { ...base, state: 'invalid' };
  return { ...base, quantity: cell.v, state: 'number' };
}

/** ALMUS layout adapter: detect/validate headers; never evaluate formulas or links. */
export function parseForecastWorkbook(workbook: XLSX.WorkBook, sourceHash: string): ForecastPreview {
  if (workbook.SheetNames.length !== 1) throw new ForecastInputError('unsupported_template');
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet?.['!ref']) throw new ForecastInputError('unsupported_template');
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if (range.e.r > 999 || range.e.c > 199) throw new ForecastInputError('sheet_too_large', 413);
  const candidates: number[] = [];
  for (let row = 0; row <= Math.min(39, range.e.r); row++) {
    if (text(cellAt(sheet, row, 5)) === 'Model' && text(cellAt(sheet, row, 6)) === 'Process' && text(cellAt(sheet, row, 7)) === 'Vendor') candidates.push(row);
  }
  if (candidates.length !== 1) throw new ForecastInputError('unsupported_template');
  const header = candidates[0];
  const dateColumns: Array<{ col: number; date: string }> = [];
  for (let col = 8; col <= range.e.c; col++) {
    const value = cellAt(sheet, header + 1, col)?.v;
    if (value === undefined) {
      // Trailing formatting is allowed, a missing date above actual quantities is not.
      for (let row = header + 2; row <= range.e.r; row++) if (cellAt(sheet, row, col)?.v !== undefined || cellAt(sheet, row, col)?.f) throw new ForecastInputError('invalid_dates');
      continue;
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) throw new ForecastInputError('invalid_dates');
    const parts = XLSX.SSF.parse_date_code(value, { date1904: Boolean(workbook.Workbook?.WBProps?.date1904) });
    if (!parts || parts.y < 2000 || parts.y > 2100) throw new ForecastInputError('invalid_dates');
    const date = `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
    if (dateColumns.length && date <= dateColumns[dateColumns.length - 1].date) throw new ForecastInputError('invalid_dates');
    dateColumns.push({ col, date });
  }
  if (!dateColumns.length) throw new ForecastInputError('invalid_dates');
  const rows: ForecastSourceRow[] = [];
  let excludedRows = 0;
  const duplicates = new Map<string, ForecastSourceRow>();
  for (let row = header + 2; row <= range.e.r; row++) {
    const group = text(cellAt(sheet, row, 2));
    const processLabel = text(cellAt(sheet, row, 6));
    if (!group && !/^CNC/i.test(processLabel)) continue;
    if (!/^CNC/i.test(group) && !/^CNC/i.test(processLabel)) { excludedRows++; continue; }
    const model = text(cellAt(sheet, row, 3));
    const vendor = mergedLabel(sheet, row, 7);
    const supported = group === 'CNC' && /^CNC\s*1\s*~\s*CNC\s*2$/i.test(processLabel);
    const entry: ForecastSourceRow = {
      sourceRow: row + 1, model, displayModel: mergedLabel(sheet, row, 5), vendor,
      processGroup: group, processLabel, processes: supported ? ['CNC1', 'CNC2'] : [], issues: [],
      quantities: dateColumns.map(({ col, date }) => quantity(cellAt(sheet, row, col), date, XLSX.utils.encode_cell({ r: row, c: col }))),
    };
    if (!model) entry.issues.push('missing_model');
    if (!vendor) entry.issues.push('missing_vendor');
    if (!supported) entry.issues.push('unsupported_process');
    const key = JSON.stringify([model, group, processLabel, vendor]);
    const previous = duplicates.get(key);
    if (previous) { entry.issues.push('duplicate_row'); if (!previous.issues.includes('duplicate_row')) previous.issues.push('duplicate_row'); }
    else duplicates.set(key, entry);
    rows.push(entry);
  }
  if (!rows.length) throw new ForecastInputError('no_cnc_rows');
  const summary: ForecastPreview['summary'] = {
    sourceRows: rows.length, excludedRows, models: new Set(rows.map(row => row.model).filter(Boolean)).size,
    formulaCells: 0, numericTotal: 0, states: { number: 0, blank: 0, error: 0, missing_cache: 0, invalid: 0 },
    fractionalCells: 0, rowIssues: rows.filter(row => row.issues.length).length,
  };
  for (const row of rows) for (const value of row.quantities) {
    summary.states[value.state]++;
    if (value.formula) summary.formulaCells++;
    if (value.quantity !== null) { summary.numericTotal += value.quantity; if (!Number.isInteger(value.quantity)) summary.fractionalCells++; }
  }
  if (!Number.isFinite(summary.numericTotal) || summary.numericTotal > Number.MAX_SAFE_INTEGER) throw new ForecastInputError('quantity_overflow');
  return { parserVersion: 'almus-v1', sourceHash, sheet: sheetName, dates: dateColumns.map(d => d.date), rows, summary, requiresReview: true, capacityValidated: false };
}

export function parseForecastFile(buffer: Buffer): ForecastPreview {
  validateXlsxArchive(buffer);
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellDates: false, cellHTML: false, cellStyles: false, sheetRows: 1001 }); }
  catch { throw new ForecastInputError('invalid_xlsx'); }
  // !fullref signals SheetJS truncation: never accept a silently shortened file.
  if (workbook.SheetNames.some(name => workbook.Sheets[name]['!fullref'])) throw new ForecastInputError('sheet_too_large', 413);
  return parseForecastWorkbook(workbook, createHash('sha256').update(buffer).digest('hex'));
}
