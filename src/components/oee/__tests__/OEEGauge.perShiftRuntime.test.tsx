import { render } from '@testing-library/react';
import { OEEGauge } from '../OEEGauge';
import type { OEEMetrics } from '@/types';

// Doughnut 은 canvas 를 요구하므로 렌더 대상에서 제외한다. 이 테스트가 검증하는 것은
// 게이지 그림이 아니라 하단 상세행의 숫자다.
jest.mock('react-chartjs-2', () => ({ Doughnut: () => null }));

jest.mock('@/hooks/useTranslation', () => ({
  useDashboardTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${JSON.stringify(vars)})` : key,
  }),
}));

// 2026-06-17~07-17 운영 DB 실측값 (analytics_productivity RPC).
// 3,999 교대 기록에 대한 합계이며, 가동률 2426103/2439390 = 99.5% 가 여기서 나온다.
const REAL_TOTALS: OEEMetrics = {
  availability: 0.9946,
  performance: 1,
  quality: 0.9992,
  oee: 0.9938,
  actual_runtime: 2426103,
  planned_runtime: 2439390,
  ideal_runtime: 2912177,
  output_qty: 449412,
  defect_qty: 358,
};

describe('OEEGauge runtime detail rows', () => {
  it('교대 수가 주어지면 가동시간을 교대 1회 평균으로 환산한다', () => {
    const { container } = render(<OEEGauge metrics={REAL_TOTALS} shiftCount={3999} />);

    // 2426103/3999 = 606.7 → 607, 2439390/3999 = 610.0 → 610
    expect(container.textContent).toContain('607time.minutes');
    expect(container.textContent).toContain('610time.minutes');
    // 환산했으면 원본 합계가 화면에 남아 있으면 안 된다.
    expect(container.textContent).not.toContain('2426103');
    expect(container.textContent).not.toContain('2439390');
    // 평균이라는 사실과 모수를 반드시 밝힌다. 밝히지 않으면 607분이 이 기간의
    // 총 가동시간으로 읽힌다.
    expect(container.textContent).toContain('oee.perShiftRuntimeNote');
    expect(container.textContent).toContain('3999');
  });

  it('교대 수가 없으면 합계를 그대로 보여준다 (AdminDashboard 경로)', () => {
    const { container } = render(<OEEGauge metrics={REAL_TOTALS} />);

    expect(container.textContent).toContain('2426103time.minutes');
    expect(container.textContent).toContain('2439390time.minutes');
    expect(container.textContent).not.toContain('oee.perShiftRuntimeNote');
  });

  // shiftCount 가 0 이면 평균은 정의되지 않는다. 0 으로 나눠 Infinity/NaN 을 숫자인 척
  // 출력하는 것이 이 프로젝트에서 반복된 사고다 ("모름"을 숫자로 단정하기).
  it.each([0, -1, Number.NaN])('교대 수가 %p 이면 나누지 않고 합계로 물러난다', (shiftCount) => {
    const { container } = render(<OEEGauge metrics={REAL_TOTALS} shiftCount={shiftCount} />);

    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('Infinity');
    expect(container.textContent).toContain('2426103time.minutes');
  });
});
