import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ProductionRecordList quantity edits', () => {
  it('sends only base quantities and leaves OEE metrics to the server', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/production/ProductionRecordList.tsx'),
      'utf8'
    );

    expect(source).not.toMatch(/const quality = values\.output_qty/);
    expect(source).not.toMatch(/quality:\s*Math\.round\(quality/);
    expect(source).toMatch(/body:\s*JSON\.stringify\(\{\s*output_qty:\s*values\.output_qty,\s*defect_qty:\s*values\.defect_qty\s*\}\)/);
  });
});
