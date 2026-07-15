import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('daily production process standard completeness', () => {
  test('persists null performance/OEE when no historical or current standard exists', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/api/production-records/daily/route.ts'),
      'utf8'
    );
    expect(source).toMatch(/processStandardKnown/);
    expect(source).toMatch(/ideal_runtime:\s*processStandardKnown[\s\S]{0,100}\?[^:]+:\s*null/);
    expect(source).toMatch(/performance:\s*!processStandardKnown\s*\|\|[\s\S]{0,80}\?\s*null/);
    expect(source).toMatch(/oee:\s*!processStandardKnown\s*\|\|[\s\S]{0,80}\?\s*null/);
  });
});
