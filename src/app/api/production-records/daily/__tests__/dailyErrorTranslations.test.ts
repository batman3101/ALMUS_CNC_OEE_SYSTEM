/**
 * 일일 저장 오류 코드 ↔ 화면 번역 계약 (2026-11-14).
 * 라우트가 내려줄 수 있는 코드는 전부 화면이 알고(번역 대상), ko·vi 두 언어에 문구가 있어야 한다.
 * 409 두 개(record_changed·source_changed)는 화면이 따로 처리한다(messages.recordChangedReload 등).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const route = read('src/app/api/production-records/daily/route.ts');
const form = read('src/components/data-input/ShiftDataInputForm.tsx');

const routeCodes = (() => {
  const match = route.match(/type DailySaveErrorCode =([\s\S]*?);/);
  if (!match) throw new Error('DailySaveErrorCode not found');
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
})();
const CONCURRENCY = ['record_changed', 'source_changed'];
const translatedCodes = routeCodes.filter(code => !CONCURRENCY.includes(code));

const formCodes = (() => {
  const match = form.match(/const DAILY_SAVE_ERROR_CODES = new Set\(\[([\s\S]*?)\]\)/);
  if (!match) throw new Error('DAILY_SAVE_ERROR_CODES not found');
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
})();

describe('daily save error translations', () => {
  it('화면이 번역하는 코드 = 라우트 코드(동시성 409 제외)', () => {
    expect(formCodes).toEqual([...translatedCodes].sort());
  });

  it.each(['ko', 'vi'])('%s 에 모든 코드 문구가 있다', lang => {
    const json = JSON.parse(read(`public/locales/${lang}/dataInput.json`));
    for (const code of translatedCodes) {
      expect(typeof json.dailyErrors?.[code]).toBe('string');
    }
    expect(typeof json.messages.recordChangedReload).toBe('string');
    expect(typeof json.messages.downtimeChangedRetry).toBe('string');
    expect(typeof json.dataEntry.defectPendingPlaceholder).toBe('string');
    expect(typeof json.dataEntry.defectPendingHint).toBe('string');
  });
});
