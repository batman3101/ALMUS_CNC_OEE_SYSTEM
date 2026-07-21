import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 주석을 지우고 남은 실코드만 본다. 배선(콘솔 조립·서버 교대창·주기갱신)을 텍스트 계약으로 고정한다.
// 진짜 동작(모달 열림·저장·andon)의 증명은 브라우저 E2E(Plan 2 Task 8)에 있다.
const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const dash = stripComments(readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/OperatorDashboard.tsx'), 'utf8'));
const console_ = stripComments(readFileSync(
  resolve(process.cwd(), 'src/components/dashboard/operator-console/MachineConsole.tsx'), 'utf8'));

describe('운영자 통합 콘솔 배선 계약', () => {
  it('OperatorDashboard 는 설비 선택 시 MachineConsole 을 렌더한다', () => {
    expect(dash).toMatch(/<MachineConsole\b/);
  });

  it('MachineConsole 은 진척·andon·마감·불량 섹션을 한 곳에 조립한다', () => {
    expect(console_).toMatch(/<ProgressInputSection\b/);
    expect(console_).toMatch(/<DowntimeAndonSection\b/);
    expect(console_).toMatch(/<CloseShiftSection\b/);
    expect(console_).toMatch(/<DefectPendingSection\b/);
  });

  // 실시간 구간에서 OEE 를 띄우면 안 된다. 품질은 검사 전이라 모른다.
  it('실시간 구간에서 OEE 를 계산하거나 표시하지 않는다', () => {
    expect(console_).toMatch(/availabilityTimesPerformance/);
    expect(console_).not.toMatch(/calculateRealtimeProgress[\s\S]{0,400}\boee\b/);
  });

  // 교대 창은 프런트 endTime−startTime 이 아니라 서버값(progress). 하드코딩 720 금지(Finding 4).
  it('교대 창을 서버값(progress)에서 받고 미지원 구성은 fail-closed 한다', () => {
    expect(console_).not.toMatch(/operatingMinutes:\s*720/);
    expect(console_).toMatch(/shiftModelSupported/);
    expect(console_).toMatch(/progress\.operatingMinutes/);
    expect(console_).toMatch(/progress\.shiftStart/);
    expect(console_).toMatch(/from '@\/utils\/realtimeProgress'/);
  });

  it('주기 자동갱신을 progress.refresh 와 함께 배선한다 (경과율·비가동·백로그가 흐르게)', () => {
    expect(console_).toMatch(/from '@\/hooks\/useAutoRefresh'/);
    expect(console_).toMatch(/useAutoRefresh\([\s\S]{0,200}progress\.refresh/);
  });
});
