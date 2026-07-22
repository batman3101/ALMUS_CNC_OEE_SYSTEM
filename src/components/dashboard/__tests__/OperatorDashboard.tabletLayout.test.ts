import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const dashboard = read('src/components/dashboard/OperatorDashboard.tsx');
const consoleSource = read('src/components/dashboard/operator-console/MachineConsole.tsx');
const appLayout = read('src/components/layout/AppLayout.tsx');
const sidebar = read('src/components/layout/Sidebar.tsx');

describe('운영자 태블릿 입력 동선 계약', () => {
  it('태블릿에서 설비 선택 즉시 전체 폭 작업 콘솔 Drawer 를 연다', () => {
    expect(dashboard).toMatch(/handleMachineSelect[\s\S]*setSelectedMachine\(machineId\)[\s\S]*isCompactConsole[\s\S]*setConsoleOpen\(true\)/);
    expect(dashboard).toMatch(/<Drawer[\s\S]*open=\{isCompactConsole && consoleOpen\}[\s\S]*width="100%"/);
  });

  it('숫자만 입력해도 설비 번호 자동완성 목록을 만들고 선택 즉시 콘솔을 연다', () => {
    expect(dashboard).toMatch(/const matchesMachineQuery[\s\S]*machineNumber[\s\S]*numericQuery[\s\S]*machineNumber\.includes\(numericQuery\)/);
    expect(dashboard).toMatch(/<AutoComplete[\s\S]*options=\{machineSearchOptions\}[\s\S]*onSelect=/);
    expect(dashboard).toMatch(/data-testid="machine-number-search"[\s\S]*style=\{\{ width: '100%', marginBottom: 16 \}\}/);
    expect(dashboard).toMatch(/onSelect=[\s\S]*handleMachineSelect\(machine\.id\)/);
  });

  it('가로 화면은 설비 목록 1\/3, 작업 콘솔 2\/3으로 배치한다', () => {
    expect(dashboard).toMatch(/<Col xs=\{24\} lg=\{8\}[^>]*>[\s\S]*assignedMachines/);
    expect(dashboard).toMatch(/!isCompactConsole[\s\S]*<Col xs=\{24\} lg=\{16\}[^>]*>[\s\S]*renderWorkConsole/);
  });

  it('OEE 탭을 거치지 않고 작업 콘솔을 직접 렌더한다', () => {
    expect(dashboard).not.toMatch(/<Tabs\b/);
    expect(dashboard).toMatch(/const renderWorkConsole/);
  });

  it('진척 입력을 지표와 OEE보다 먼저 보여준다', () => {
    const renderedConsole = consoleSource.slice(consoleSource.indexOf('return ('));
    expect(renderedConsole.indexOf('<ProgressInputSection')).toBeGreaterThanOrEqual(0);
    expect(renderedConsole.indexOf('<ProgressInputSection')).toBeLessThan(renderedConsole.indexOf('{confirmedMetrics'));
    expect(renderedConsole).toMatch(/position:\s*'sticky'/);
  });

  it('운영자 콘솔에서는 사이드바를 접고 태블릿에서는 화면 밖으로 숨긴다', () => {
    expect(appLayout).toMatch(/isOperatorConsolePage[\s\S]*setCollapsed\(!screens\.lg \|\| isOperatorConsolePage\)/);
    expect(sidebar).toMatch(/collapsedWidth=\{screens\.lg \? 80 : 0\}/);
    expect(sidebar).toMatch(/inlineCollapsed=\{collapsed\}/);
  });
});
