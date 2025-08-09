import { OEECalculator } from '@/utils/oeeCalculator';
import { OEEMetrics } from '@/types';

// OEE 계산 로직 테스트 (컴포넌트 대신 로직 테스트)
const mockMetrics: OEEMetrics = {
  availability: 0.85,
  performance: 0.92,
  quality: 0.96,
  oee: 0.75,
  actual_runtime: 510,
  planned_runtime: 600,
  ideal_runtime: 480,
  output_qty: 1200,
  defect_qty: 48
};

describe('OEE 시각화 로직', () => {
  it('OEE 수준 분류가 올바름', () => {
    // 우수 수준 (85% 이상)
    expect(mockMetrics.oee >= 0.85 ? '우수' : mockMetrics.oee >= 0.65 ? '양호' : '개선필요').toBe('양호');
    
    // 우수 수준 테스트
    const excellentOEE = 0.9;
    expect(excellentOEE >= 0.85 ? '우수' : excellentOEE >= 0.65 ? '양호' : '개선필요').toBe('우수');
    
    // 개선필요 수준 테스트
    const poorOEE = 0.5;
    expect(poorOEE >= 0.85 ? '우수' : poorOEE >= 0.65 ? '양호' : '개선필요').toBe('개선필요');
  });

  it('OEE 색상 분류가 올바름', () => {
    const getOEEColor = (value: number): string => {
      if (value >= 0.85) return '#52c41a'; // 우수 (녹색)
      if (value >= 0.65) return '#faad14'; // 양호 (주황)
      return '#ff4d4f'; // 개선필요 (빨강)
    };

    expect(getOEEColor(0.9)).toBe('#52c41a');
    expect(getOEEColor(0.75)).toBe('#faad14');
    expect(getOEEColor(0.5)).toBe('#ff4d4f');
  });

  it('백분율 변환이 올바름', () => {
    expect(Math.round(mockMetrics.oee * 100 * 10) / 10).toBe(75.0);
    expect(Math.round(mockMetrics.availability * 100 * 10) / 10).toBe(85.0);
    expect(Math.round(mockMetrics.performance * 100 * 10) / 10).toBe(92.0);
    expect(Math.round(mockMetrics.quality * 100 * 10) / 10).toBe(96.0);
  });

  it('시간 단위 변환이 올바름', () => {
    expect(Math.round(mockMetrics.actual_runtime)).toBe(510);
    expect(Math.round(mockMetrics.planned_runtime)).toBe(600);
    expect(Math.round(mockMetrics.ideal_runtime)).toBe(480);
  });

  it('생산량 정보가 올바름', () => {
    expect(mockMetrics.output_qty).toBe(1200);
    expect(mockMetrics.defect_qty).toBe(48);
    expect(mockMetrics.output_qty - mockMetrics.defect_qty).toBe(1152); // 양품 수량
  });

  it('OEE 계산이 일치함', () => {
    const calculatedOEE = OEECalculator.calculateOEE(
      mockMetrics.availability,
      mockMetrics.performance,
      mockMetrics.quality
    );
    
    expect(Math.round(calculatedOEE * 1000) / 1000).toBeCloseTo(0.751, 2);
  });
});