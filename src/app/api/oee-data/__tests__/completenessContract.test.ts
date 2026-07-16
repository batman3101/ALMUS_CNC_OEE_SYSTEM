import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('raw OEE data completeness contract', () => {
  test('does not turn missing runtime or OEE components into invented 0/480 values', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/api/oee-data/route.ts'),
      'utf8'
    );

    expect(source).not.toMatch(/planned_runtime:\s*record\.planned_runtime\s*\|\|\s*480/);
    expect(source).not.toMatch(/availability:\s*Number\(record\.availability\s*\|\|\s*0\)/);
    expect(source).not.toMatch(/performance:\s*Number\(record\.performance\s*\|\|\s*0\)/);
    expect(source).not.toMatch(/oee:\s*Number\(record\.oee\s*\|\|\s*0\)/);
    expect(source).toMatch(/planned_runtime:\s*toNullableNumber\(record\.planned_runtime\)/);
  });
});
