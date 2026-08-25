import fs from 'fs';
import path from 'path';

/**
 * 설비가 0대인 공장은 **오류가 아니다.**
 *
 * ## 무엇이 있었나 (2026-08-25 운영 브라우저 검증에서 발견)
 *
 * ALV(신설 공장, 설비 0대)로 전환하니 대시보드가 이렇게 떴다:
 *
 *   대시보드 오류
 *   대시보드를 불러오는 중 오류가 발생했습니다.
 *
 * 같은 시각 설비 현황 화면은 **"0/0 — 조건에 맞는 설비가 없습니다"** 로 올바르게 표시했다.
 * 즉 데이터도 API 도 정상이고, 대시보드만 0대를 장애로 판정했다.
 *
 * ## 왜 그렇게 됐나 — 정보가 먼저 사라졌다
 *
 * 조회 실패는 `.catch()` 가 `[]` 로 바꿔 삼켰다:
 *
 *   fetchMachines().catch(() => [])      // 여기서 "실패했다"가 사라진다
 *   ...
 *   if (machinesData.length === 0) throw  // 남은 것은 길이 0 뿐
 *
 * 길이 0 은 "실패"와 "설비 없음"을 모두 뜻할 수 있다. 그 둘을 구별할 정보를 catch 가
 * 이미 버렸으므로, 이 판정은 **원리적으로** 옳을 수 없었다. ALT 는 항상 800대라 이 분기가
 * 닿은 적이 없어 드러나지 않았을 뿐이다.
 *
 * 이 저장소가 반복해 적어 둔 규칙과 같은 형태다 — CLAUDE.md 의 "NULL 은 0% 가 아니다",
 * "조회 실패와 0건은 다르다". 이번에는 그 혼동이 **화면 전체를 장애로** 만들었다.
 *
 * ## 왜 소스를 문자열로 보나
 *
 * 이 컴포넌트는 컨텍스트 7개와 훅 여러 개에 의존해 렌더 테스트 비용이 크다. 같은 이유로
 * 이 디렉터리의 다른 검사들(`AdminDashboard.alerts.test.ts`)도 소스를 직접 본다.
 * 여기서 지키려는 것은 렌더 결과가 아니라 **판정의 근거**이므로 그 근거를 직접 본다.
 */
const source = fs.readFileSync(
  path.join(process.cwd(), 'src/components/dashboard/AdminDashboard.tsx'),
  'utf8'
);

describe('빈 공장은 장애가 아니다', () => {
  it('설비 조회 실패를 길이가 아니라 별도 플래그로 기억한다', () => {
    // `.catch(() => [])` 로 실패를 삼키면서 그 사실을 어디에도 남기지 않으면,
    // 뒤에서 실패와 0건을 구별할 방법이 없다.
    expect(source).toMatch(/machinesFailed\s*=\s*true/);
    expect(source).toMatch(/if\s*\(\s*machinesFailed\s*\)\s*\{[\s\S]{0,200}throw new Error/);
  });

  it('설비 0대를 조회 실패로 판정하지 않는다', () => {
    // 되살아나기 가장 쉬운 형태를 직접 막는다.
    expect(source).not.toMatch(
      /if\s*\(\s*machinesData\.length\s*===\s*0\s*\)\s*\{[\s\S]{0,160}throw new Error/
    );
  });

  it('설비가 0대면 오류 대신 빈 대시보드를 돌려준다', () => {
    // 위 분기가 `machines.length > 0` 을 요구하므로 빈 공장은 마지막 throw 까지 떨어진다.
    // 그 앞에서 빈 결과로 빠져나와야 한다.
    expect(source).toMatch(
      /dashboardData\.machines\.length\s*===\s*0[\s\S]{0,320}machinesWithDataCount:\s*0/
    );
  });

  it('설비 현황 화면은 0대를 빈 목록으로 다룬다 (대시보드가 따라야 할 기준)', () => {
    // 같은 앱 안에 이미 옳은 처리가 있었다. 대시보드만 달랐다는 사실을 못 박아 둔다.
    const machineList = fs.readFileSync(
      path.join(process.cwd(), 'src/components/machines/MachineList.tsx'),
      'utf8'
    );
    expect(machineList).not.toMatch(/length\s*===\s*0[\s\S]{0,120}throw new Error/);
  });
});
