/**
 * 목록 API 가 일일 저장 지문 컬럼을 **DB 값 그대로** 돌려주는가 (감사 2026-11-14 F-02 후속).
 *
 * 데이터 입력 화면은 GET /api/production-records 의 기록을 지문(expected_records)으로 되돌려 보내고,
 * save_daily_production_v2 는 그 지문을 DB 행과 컬럼마다 대조한다. 목록 API 가 한 컬럼이라도 빼거나
 * 바꿔서 보내면(예: downtime_minutes 를 안 보내 화면에서는 null) 지문이 절대 맞지 않아
 * **기존 기록 수정이 항상 409** 가 된다. 실제로 브라우저 종단 검증에서 그렇게 드러났다
 * (DB downtime_minutes=0·tact=560 인데 화면 지문은 null·null).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const listRoute = read('src/app/api/production-records/route.ts');
const dailyRoute = read('src/app/api/production-records/daily/route.ts');

const expectedColumns = (() => {
  const match = dailyRoute.match(/const EXPECTED_RECORD_COLUMNS = \[([\s\S]*?)\]/);
  if (!match) throw new Error('EXPECTED_RECORD_COLUMNS not found');
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
})();

const formatted = (() => {
  const start = listRoute.indexOf('const formattedRecords = (records || []).map(record => ({');
  if (start < 0) throw new Error('formattedRecords not found');
  return listRoute.slice(start, listRoute.indexOf('}));', start));
})();

describe('목록 API ↔ 일일 저장 지문 계약', () => {
  it('record_id 를 그대로 돌려준다', () => {
    expect(formatted).toMatch(/record_id:\s*record\.record_id\b/);
  });

  it.each(expectedColumns)('%s 를 DB 값 그대로(?? null, 또는 NOT NULL 인 output_qty) 돌려준다', column => {
    const passthrough = new RegExp(`\\b${column}:\\s*record\\.${column}\\s*\\?\\?\\s*null`);
    // output_qty 는 NOT NULL(default 0) 이라 `|| 0` 이 값을 바꾸지 않는다.
    const notNullOutput = column === 'output_qty' && /\boutput_qty:\s*record\.output_qty\s*\|\|\s*0/.test(formatted);
    expect(passthrough.test(formatted) || notNullOutput).toBe(true);
  });
});
