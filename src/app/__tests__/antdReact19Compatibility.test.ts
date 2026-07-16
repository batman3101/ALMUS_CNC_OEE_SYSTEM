import fs from 'node:fs';
import path from 'node:path';

describe('Ant Design React 19 compatibility contract', () => {
  it('loads the official Ant Design v5 React 19 patch from the client provider entry', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    ) as {
      dependencies?: Record<string, string>;
    };
    const providersSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/providers.tsx'),
      'utf8'
    );

    expect(packageJson.dependencies).toHaveProperty(
      '@ant-design/v5-patch-for-react-19'
    );
    expect(providersSource).toMatch(
      /^['"]use client['"];\s+import ['"]@ant-design\/v5-patch-for-react-19['"];/
    );
  });
});
