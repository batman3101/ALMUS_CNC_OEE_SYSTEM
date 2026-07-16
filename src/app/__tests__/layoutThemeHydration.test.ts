import fs from 'node:fs';
import path from 'node:path';

describe('root layout theme hydration contract', () => {
  it('marks the html and body elements as intentionally theme-dependent', () => {
    const layoutSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/layout.tsx'),
      'utf8'
    );

    expect(layoutSource).toMatch(/<html[^>]*suppressHydrationWarning/);
    expect(layoutSource).toMatch(/<body[^>]*suppressHydrationWarning/);
  });
});
