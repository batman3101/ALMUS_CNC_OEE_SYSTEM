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

  // 날짜가 잘려 "2026-07-1" 로 보이던 문제: 입력칸 63px vs 필요 72px (실측).
  // 240px 부터 여유가 생기며 260px 을 채택했다.
  it('gives the date range picker enough width to render YYYY-MM-DD on both ends', () => {
    const width = source.match(/placeholder=\{\[t\('dashboard:time\.startDate'\)[\s\S]{0,200}?width:\s*(\d+)/);
    expect(width).not.toBeNull();
    expect(Number(width![1])).toBeGreaterThanOrEqual(240);
  });
});
