import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 주석을 지우고 남은 실코드만 본다. 아래 계약은 파일 텍스트를 검사하는 "배선 확인"이다 —
// 단위(calculateRealtimeProgress·useRealtimeProgress·ProgressInputModal)는 Task 1~7 에서
// 이미 동작 검증됐고, 여기서는 그것들이 OperatorDashboard 에 실제로 연결됐는지만 본다.
// 진짜 동작(모달 열림, 지표 표시, 주기 갱신)의 증명은 Task 9(브라우저 검증)에 있다.
const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('OperatorDashboard 실시간 진행 계약', () => {
  const source = stripComments(
    readFileSync(resolve(process.cwd(), 'src/components/dashboard/OperatorDashboard.tsx'), 'utf8')
  );

  it('진행 보고 입력 모달을 연결한다', () => {
    // 계획서 원안 /ProgressInputModal/ 는 약하다 — import 경로
    // '@/components/production/ProgressInputModal' 자체가 이 문자열을 담고 있어,
    // 모달을 렌더하지 않고 import 만 남겨도 통과한다. JSX 로 실제 렌더되는지를 본다.
    expect(source).toMatch(/<ProgressInputModal\b/);
  });

  // 실시간 화면에 OEE 를 띄우면 안 된다. 품질은 검사 전이라 모른다.
  it('실시간 구간에서 OEE 를 계산하거나 표시하지 않는다', () => {
    expect(source).toMatch(/availabilityTimesPerformance/);
    expect(source).not.toMatch(/calculateRealtimeProgress[\s\S]{0,400}\boee\b/);
  });

  it('계산은 순수 함수에 위임한다 (컴포넌트에서 다시 만들지 않는다)', () => {
    expect(source).toMatch(/from '@\/utils\/realtimeProgress'/);
  });

  // 추가(사용자 결정): 주기 자동갱신 배선도 계약에 포함한다. 이게 없으면 화면은
  // "열 때 + 저장할 때"만 갱신되고, 그 사이 경과시간 기반 지표(가동×성능·진척)가 얼어붙으며
  // 다른 곳에서 기록된 비가동도 저장 전엔 안 보인다.
  it('주기 자동갱신을 progress.refresh 와 함께 배선한다', () => {
    expect(source).toMatch(/from '@\/hooks\/useAutoRefresh'/);
    // useAutoRefresh 콜백 안에서 progress.refresh 를 부른다.
    // 간격은 useAutoRefresh 내부에서 displaySettings.refreshInterval 을 상속하므로
    // 여기서 하드코딩된 간격을 검사하지 않는다.
    expect(source).toMatch(/useAutoRefresh\([\s\S]{0,200}progress\.refresh/);
  });

  // Finding 2: 진행 보고 버튼은 확정 OEE(selectedMachineMetrics) 종속에서 벗어나야 한다.
  // Finding 7: 경과율(elapsedRatio)을 화면에 띄운다.
  it('진행 보고 버튼과 경과율을 배선한다', () => {
    expect(source).toMatch(/operator\.reportProgress/);
    expect(source).toMatch(/setProgressModalOpen\(true\)/);
    expect(source).toMatch(/operator\.elapsedRatio/);
    expect(source).toMatch(/realtime\.elapsedRatio/);
  });

  // Finding 4: 교대 길이를 하드코딩 720 이 아니라 설정에서 도출하고, 720 모델이 아니면
  // fail-closed 한다. 하드코딩 리터럴이 되살아나면 8·10시간 교대에서 CAPA·경과율이 틀린다.
  it('교대 길이를 설정에서 도출하고 미지원 구성은 fail-closed 한다', () => {
    expect(source).not.toMatch(/operatingMinutes:\s*720/);
    expect(source).toMatch(/shiftModelSupported/);
  });
});
