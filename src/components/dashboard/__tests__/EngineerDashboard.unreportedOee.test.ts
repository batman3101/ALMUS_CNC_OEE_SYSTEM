import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('EngineerDashboard unavailable OEE contract', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/dashboard/EngineerDashboard.tsx'),
    'utf8'
  );

  it('does not grade or render unreported machines as 0% OEE', () => {
    expect(source).toMatch(/reported_records\s*>\s*0/);
    expect(source).toMatch(/avg_oee\s*!==\s*null/);
    expect(source).toMatch(/oeeUnavailable/);
    expect(source).not.toMatch(/const hasData = Boolean\(stat && stat\.total_records > 0\)/);
  });

  // 조회가 끝나기 전에 "기록이 없다"고 단정하면 안 된다. /api/productivity-analysis 는
  // 실측 9.5초가 걸리는 구간이 있어, 그동안 KPI 는 "—", 게이지는 oeeUnavailable 을
  // 띄웠고 사용자에게는 새로고침이 끝나지 않는 고장으로 읽혔다 (2026-07-17 관측).
  // "아직 모름"과 "없음"은 다르다.
  it('shows a loading state instead of claiming no data while fetching', () => {
    // 상단 KPI 4개: 값이 아직 없고 로딩 중이면 스켈레톤. 갱신 중(값 보유)에는 이전 값 유지.
    const kpiSkeletons = source.match(/<Card loading=\{loading && !processedData\.overallMetrics\}>/g) ?? [];
    expect(kpiSkeletons).toHaveLength(4);

    // 전체 OEE 현황 게이지의 빈 상태 Card 도 loading 을 반영해야 한다.
    expect(source).toMatch(
      /<Card[\s\S]{0,160}charts\.overallOeeStatus[\s\S]{0,120}loading=\{loading\}[\s\S]{0,200}oeeUnavailable/
    );

    // 로딩 가드 없이 곧바로 빈 상태로 떨어지는 형태로 되돌아가지 않도록 고정.
    expect(source).not.toMatch(
      /<Card title=\{t\('dashboard:engineerDashboard\.charts\.overallOeeStatus'\)\}>\s*<Empty/
    );
  });

  // "가동률 99.5%" 를 그리면서 그 근거인 가동시간을 "0분" 이라고 단정하던 문제
  // (2026-07-17 관측). 값이 없어서 0 이 아니라, API 가 이미 계산해 둔 합계를 응답에
  // 싣지 않아서 0 이었다. 0 은 측정값이 아니라 지어낸 값이다.
  it('feeds the gauge real runtime sums instead of hardcoded zeros', () => {
    expect(source).toMatch(/actual_runtime:\s*overallPerformance\.total_actual_runtime/);
    expect(source).toMatch(/planned_runtime:\s*overallPerformance\.total_planned_runtime/);
    expect(source).toMatch(/ideal_runtime:\s*overallPerformance\.total_ideal_runtime/);

    // 어떤 분기에서도 runtime 을 0 으로 지어내지 않는다.
    expect(source).not.toMatch(/actual_runtime:\s*0/);
    expect(source).not.toMatch(/planned_runtime:\s*0/);
    expect(source).not.toMatch(/ideal_runtime:\s*0/);
  });

  // 합계를 그대로 찍으면 2,426,103분이 되어 판독이 불가능하다. 교대 평균 환산은
  // 게이지가 하되, 분모는 runtime 합계와 같은 모수여야 한다. RPC 가 runtime 을
  // oee_reported 로 필터해 합산하므로 records_count 로 나누면 평균이 작아진다.
  it('averages gauge runtime over the same population the sums cover', () => {
    expect(source).toMatch(/shiftCount=\{reportingCoverage\?\.reported_records\}/);
    expect(source).not.toMatch(/shiftCount=\{[^}]*records_count/);
  });

  // 날짜가 잘려 "2026-07-1" 로 보이던 문제: 입력칸 63px vs 필요 72px (실측).
  // 240px 부터 여유가 생기며 260px 을 채택했다.
  it('gives the date range picker enough width to render YYYY-MM-DD on both ends', () => {
    const width = source.match(/placeholder=\{\[t\('dashboard:time\.startDate'\)[\s\S]{0,200}?width:\s*(\d+)/);
    expect(width).not.toBeNull();
    expect(Number(width![1])).toBeGreaterThanOrEqual(240);
  });
});
