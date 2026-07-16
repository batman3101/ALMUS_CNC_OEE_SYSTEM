import fs from 'fs';
import path from 'path';

describe('AdminDashboard alert eligibility', () => {
  it('does not classify machines with no production data as low-OEE machines', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/dashboard/AdminDashboard.tsx'),
      'utf8'
    );

    expect(source).toMatch(
      /dbMachinesWithData\.includes\(machine\.id\)[\s\S]{0,160}machine\.oee !== null[\s\S]{0,80}machine\.oee < 0\.6/
    );
    expect(source).not.toMatch(/oee:\s*dbOeeMetrics\[machine\.id\]\?\.oee \|\| 0/);
  });

  it('shows unavailable OEE without assigning a red grade or gauge metric', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/dashboard/AdminDashboard.tsx'),
      'utf8'
    );

    expect(source).toMatch(/const calculateRealTimeOEEMetrics = \(\): OEEMetrics \| null/);
    expect(source).toMatch(/aggregated\.avgOEE === null/);
    expect(source).toMatch(/overallMetrics:\s*null/);
    expect(source).toMatch(/value=\{processedData\.overallMetrics[\s\S]{0,160}: '—'/);
    expect(source).toMatch(/<Empty description=\{t\('downtimeReporting\.oeeUnavailable'\)\}/);
  });

  it('renders persisted operational alerts instead of a disabled empty placeholder', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/dashboard/AdminDashboard.tsx'),
      'utf8'
    );

    expect(source).toMatch(/useOperationalAlerts\(\)/);
    expect(source).not.toMatch(/const realtimeAlerts:[\s\S]{0,240}= \[\]/);
    expect(source).not.toMatch(/const acknowledgeAlert = \([^)]*\) => \{ void id; \}/);
  });

  it('clears both general machine notifications and persisted operational alerts', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/dashboard/AdminDashboard.tsx'),
      'utf8'
    );

    expect(source).toMatch(/clearAllNotifications/);
    expect(source).toMatch(/clearAllVisibleAlerts/);
    expect(source).toMatch(/Promise\.all\(\[clearAllNotifications\(\), clearAllAlerts\(\)\]\)/);
    expect(source).toMatch(/onClick=\{clearAllVisibleAlerts\}/);
  });

  it('never invents machine master data or current state from OEE when the machine API fails', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/dashboard/AdminDashboard.tsx'),
      'utf8'
    );

    expect(source).not.toMatch(/location:\s*'Production Floor'/);
    expect(source).not.toMatch(/current_state:\s*machine\.avg_oee\s*>\s*0\.7/);
  });

  it('uses Drawer semantic styles instead of deprecated headerStyle and bodyStyle props', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/dashboard/AdminDashboard.tsx'),
      'utf8'
    );

    expect(source).not.toMatch(/\bheaderStyle=/);
    expect(source).not.toMatch(/\bbodyStyle=/);
    expect(source).toMatch(
      /<Drawer[\s\S]*?styles=\{\{[\s\S]*?header:\s*\{[\s\S]*?body:\s*\{/
    );
  });
});
