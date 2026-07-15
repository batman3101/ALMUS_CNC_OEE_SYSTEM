import fs from 'fs';
import path from 'path';

describe('EngineerDashboard data failure visibility', () => {
  it('renders the engineer analysis error for the user instead of only logging it', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/dashboard/EngineerDashboard.tsx'),
      'utf8'
    );

    expect(source).toMatch(/\{error && \([\s\S]{0,500}<Alert/);
    expect(source).toMatch(/description=\{error\}/);
  });
});
