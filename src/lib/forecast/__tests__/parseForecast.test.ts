import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { parseForecastFile, parseForecastWorkbook } from '../parseForecast';
import { ForecastInputError, validateXlsxArchive } from '../xlsxArchive';

function fixture(): XLSX.WorkBook {
  const sheet: XLSX.WorkSheet = {
    F13: { t: 's', v: 'Model' }, G13: { t: 's', v: 'Process' }, H13: { t: 's', v: 'Vendor' },
    I14: { t: 'n', v: 46287 }, J14: { t: 'n', v: 46288 },
    C15: { t: 's', v: 'CNC' }, D15: { t: 's', v: 'H8 MAIN' }, F15: { t: 's', v: 'H8 MAIN' }, G15: { t: 's', v: 'CNC 1 ~ CNC 2' }, H15: { t: 's', v: 'ALMUS' },
    I15: { t: 'n', v: 9000, f: "'[2]Remote'!A1" }, J15: { t: 'n', v: 0 },
    C16: { t: 's', v: 'CL-DB' }, D16: { t: 's', v: 'H8 MAIN' }, G16: { t: 's', v: 'CL1~CL2' }, I16: { t: 'n', v: 9000 },
    '!ref': 'A1:J16', '!merges': [{ s: { r: 14, c: 5 }, e: { r: 15, c: 5 } }, { s: { r: 14, c: 7 }, e: { r: 15, c: 7 } }],
  };
  return { SheetNames: ['ALMUS TECH'], Sheets: { 'ALMUS TECH': sheet } };
}
const sheetOf = (book: XLSX.WorkBook) => book.Sheets['ALMUS TECH'];

describe('Forecast parser', () => {
  it('uses one quantity for both CNC processes and excludes downstream rows', () => {
    const result = parseForecastWorkbook(fixture(), 'hash');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].processes).toEqual(['CNC1', 'CNC2']);
    expect(result.rows[0].quantities[0]).toMatchObject({ date: '2026-09-22', cell: 'I15', quantity: 9000, formula: true });
    expect(result.summary.numericTotal).toBe(9000);
    expect(result.summary.excludedRows).toBe(1);
    expect(result.capacityValidated).toBe(false);
    expect(result.requiresReview).toBe(true);
  });
  it('reads a real zipped workbook and retains formula cached values without calculating', () => {
    const buffer: Buffer = XLSX.write(fixture(), { type: 'buffer', bookType: 'xlsx', compression: true });
    const result = parseForecastFile(buffer);
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.rows[0].quantities[0].quantity).toBe(9000);
  });
  it.each([
    [undefined, 'blank', null], [{ t: 'n', v: 0 }, 'number', 0],
    [{ t: 'e', v: 42, w: '#N/A' }, 'error', null], [{ t: 'n', f: '1+2' }, 'missing_cache', null],
    [{ t: 'n', v: -1 }, 'invalid', null], [{ t: 's', v: '9000' }, 'invalid', null],
    [{ t: 'n', v: Infinity }, 'invalid', null], [{ t: 'n', v: 1.25 }, 'number', 1.25],
  ] as const)('preserves value states: %j', (cell, state, expected) => {
    const book = fixture();
    if (cell) sheetOf(book).I15 = cell; else delete sheetOf(book).I15;
    const result = parseForecastWorkbook(book, 'hash');
    expect(result.rows[0].quantities[0]).toMatchObject({ state, quantity: expected });
    if (expected === 1.25) expect(result.summary.fractionalCells).toBe(1);
  });
  it('does not force CNC35 into CNC1/2', () => {
    const book = fixture(); sheetOf(book).C15.v = 'CNC35'; sheetOf(book).G15.v = 'CNC 3 ~ CNC 5';
    expect(parseForecastWorkbook(book, 'hash').rows[0]).toMatchObject({ processes: [], issues: ['unsupported_process'] });
  });
  it('reports duplicate rows and resolves labels only within their own merged ranges', () => {
    const book = fixture(), sheet = sheetOf(book);
    sheet.C16.v = 'CNC'; sheet.G16.v = 'CNC 1 ~ CNC 2';
    const result = parseForecastWorkbook(book, 'hash');
    expect(result.rows[1].vendor).toBe('ALMUS');
    expect(result.rows.every(row => row.issues.includes('duplicate_row'))).toBe(true);
    delete sheet['!merges'];
    expect(parseForecastWorkbook(book, 'hash').rows[1].issues).toContain('missing_vendor');
  });
  it('rejects changed headers, duplicate/missing dates, and multiple sheets', () => {
    let book = fixture(); sheetOf(book).F13.v = 'Something else';
    expect(() => parseForecastWorkbook(book, 'hash')).toThrow('unsupported_template');
    book = fixture(); sheetOf(book).J14.v = sheetOf(book).I14.v;
    expect(() => parseForecastWorkbook(book, 'hash')).toThrow('invalid_dates');
    book = fixture(); delete sheetOf(book).I14;
    expect(() => parseForecastWorkbook(book, 'hash')).toThrow('invalid_dates');
    book = fixture(); book.SheetNames.push('Second');
    expect(() => parseForecastWorkbook(book, 'hash')).toThrow('unsupported_template');
  });
  it('rejects invalid ZIP, compressed/expanded limits and misleading local entry sizes', () => {
    expect(() => validateXlsxArchive(Buffer.from('not xlsx'))).toThrow(ForecastInputError);
    expect(() => validateXlsxArchive(Buffer.alloc(4 * 1024 * 1024 + 1))).toThrow('file_too_large');
    const buffer: Buffer = XLSX.write(fixture(), { type: 'buffer', bookType: 'xlsx', compression: true });
    const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const bomb = Buffer.from(buffer); bomb.writeUInt32LE(20 * 1024 * 1024, central + 24);
    expect(() => validateXlsxArchive(bomb)).toThrow('expanded_too_large');
    const corrupt = Buffer.from(buffer); corrupt.writeUInt32LE(999, 18);
    expect(() => validateXlsxArchive(corrupt)).toThrow('invalid_xlsx');
  });
});

const samplePath = process.env.FORECAST_SAMPLE_PATH;
(samplePath ? it : it.skip)('matches the user sample: 73 CNC rows, 77 days, W39 numeric sum and 24 blanks', () => {
  const result = parseForecastFile(readFileSync(samplePath!));
  expect(result.summary.sourceRows).toBe(73);
  expect(result.summary.models).toBe(72);
  expect(result.dates).toHaveLength(77);
  const week = result.rows.flatMap(row => row.quantities.filter(q => q.date >= '2026-09-21' && q.date <= '2026-09-27'));
  expect(week.reduce((sum, q) => sum + (q.quantity ?? 0), 0)).toBeCloseTo(326464.70588235295, 6);
  expect(week.filter(q => q.state === 'blank')).toHaveLength(24);
  expect(result.sourceHash).toBe('972402c59cc5aec580d5a6f043966ac68162191e5d8fccf47c9026598e7802b3');
});
