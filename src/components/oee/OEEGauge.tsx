'use client';

import React from 'react';
import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Card, Typography, Row, Col, Progress } from 'antd';
import { OEEMetrics } from '@/types';
import { useDashboardTranslation } from '@/hooks/useTranslation';
import { useChartAnimation } from '@/hooks/useChartAnimation';
import { useOEEGrading } from '@/hooks/useOEEThresholds';
import type { OEEGrade } from '@/lib/oeeGrading';

ChartJS.register(ArcElement, Tooltip, Legend);

const { Title, Text } = Typography;

// 등급 문구는 기존 번역 키(3개)를 그대로 쓴다. 사다리는 네 칸이지만 문구는 세 가지이므로
// 아래 두 칸이 같은 문구('개선필요')를 공유한다 — 색은 여전히 주황/빨강으로 구분된다.
const OEE_LEVEL_KEY: Record<OEEGrade, string> = {
  excellent: 'oee.level.excellent',
  good: 'oee.level.good',
  warning: 'oee.level.needsImprovement',
  critical: 'oee.level.needsImprovement',
};

interface OEEGaugeProps {
  metrics: OEEMetrics;
  title?: string;
  size?: 'small' | 'default' | 'large';
  showDetails?: boolean;
  /**
   * 집계에 포함된 교대 수. 주어지면 가동시간 상세행을 교대 1회 평균으로 환산한다.
   *
   * metrics 의 runtime 은 언제나 기간 합계다. 설비 한 대짜리 게이지에서는 그대로 읽히지만,
   * 전사 게이지(전체 설비 × 전체 일자)에서는 수백만 분이 찍혀 판독이 불가능하다.
   * 합계를 평균으로 바꾸는 것은 표현 계층의 결정이므로 OEEMetrics 를 오염시키지 않고
   * 여기서만 환산한다 — actual_runtime 에 평균을 담으면 다음 사람이 합계로 읽는다.
   *
   * 비율(가동률·성능·품질)은 척도 불변이라 환산해도 값이 변하지 않는다.
   */
  shiftCount?: number | null;
}

export const OEEGauge: React.FC<OEEGaugeProps> = ({
  metrics,
  title = 'OEE',
  size = 'default',
  showDetails = true,
  shiftCount
}) => {
  const { t } = useDashboardTranslation();
  const chartAnimation = useChartAnimation();
  const { gradeOf } = useOEEGrading();
  const { availability, performance, quality, oee } = metrics;

  // 0·음수·NaN 이면 교대 1회 평균이 정의되지 않는다. 나눠서 Infinity/NaN 을 숫자인 척
  // 출력하느니 합계를 그대로 보여준다.
  const perShiftCount =
    typeof shiftCount === 'number' && Number.isFinite(shiftCount) && shiftCount > 0
      ? shiftCount
      : null;
  const runtimeDivisor = perShiftCount ?? 1;

  // 색과 문구는 같은 사다리를 두 번 적은 것이었고, 그 사다리는 관리자 설정을 읽지 않는
  // 세 번째 사본이었다. 이제 둘 다 하나의 판정 결과에서 나온다 — 색과 문구가 어긋날 수 없다.
  const gaugeGrade = gradeOf(oee);
  const oeeColor = gaugeGrade.color;

  const oeeLevelText = gaugeGrade.grade === null ? '' : t(OEE_LEVEL_KEY[gaugeGrade.grade]);

  // 게이지 차트 데이터
  const gaugeData = {
    datasets: [
      {
        data: [oee * 100, 100 - oee * 100],
        backgroundColor: [oeeColor, '#f0f0f0'],
        borderWidth: 0,
        cutout: '70%',
      },
    ],
  };

  // 차트 옵션
  const gaugeOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    // display.chart_animation_enabled — 켜짐은 undefined(라이브러리 기본값)로 표현한다.
    animation: chartAnimation.chartJs,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: false,
      },
    },
    rotation: -90,
    circumference: 180,
  };

  // 크기별 설정
  const sizeConfig = {
    small: { height: 120, titleSize: 16, valueSize: 24 },
    default: { height: 200, titleSize: 18, valueSize: 32 },
    large: { height: 280, titleSize: 20, valueSize: 40 },
  };

  const config = sizeConfig[size];

  return (
    <Card>
      <div style={{ textAlign: 'center' }}>
        <Title level={4} style={{ fontSize: config.titleSize, marginBottom: 16 }}>
          {title}
        </Title>
        
        {/* OEE 게이지 차트 */}
        <div style={{ position: 'relative', height: config.height, marginBottom: 16 }}>
          <Doughnut data={gaugeData} options={gaugeOptions} />
          
          {/* 중앙 OEE 값 표시 */}
          <div
            style={{
              position: 'absolute',
              top: '60%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: config.valueSize, fontWeight: 'bold', color: oeeColor }}>
              {(oee * 100).toFixed(1)}%
            </div>
            <div style={{ fontSize: 14, color: '#666', marginTop: 4 }}>
              {oeeLevelText}
            </div>
          </div>
        </div>

        {/* 세부 지표 표시 */}
        {showDetails && (
          <div>
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <div style={{ textAlign: 'center' }}>
                  <Progress
                    type="circle"
                    percent={availability * 100}
                    size={size === 'small' ? 60 : size === 'large' ? 100 : 80}
                    strokeColor="#1890ff"
                    format={(percent) => `${percent?.toFixed(1)}%`}
                  />
                  <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                    {t('oee.availability')}
                  </div>
                </div>
              </Col>
              
              <Col span={8}>
                <div style={{ textAlign: 'center' }}>
                  <Progress
                    type="circle"
                    percent={performance * 100}
                    size={size === 'small' ? 60 : size === 'large' ? 100 : 80}
                    strokeColor="#52c41a"
                    format={(percent) => `${percent?.toFixed(1)}%`}
                  />
                  <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                    {t('oee.performance')}
                  </div>
                </div>
              </Col>
              
              <Col span={8}>
                <div style={{ textAlign: 'center' }}>
                  <Progress
                    type="circle"
                    percent={quality * 100}
                    size={size === 'small' ? 60 : size === 'large' ? 100 : 80}
                    strokeColor="#faad14"
                    format={(percent) => `${percent?.toFixed(1)}%`}
                  />
                  <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                    {t('oee.quality')}
                  </div>
                </div>
              </Col>
            </Row>

            {/* 추가 정보 */}
            <div style={{ marginTop: 16, textAlign: 'left' }}>
              <Row gutter={[16, 8]}>
                <Col span={12}>
                  <Text type="secondary">{t('oee.actualRuntime')}:</Text>
                  <Text strong style={{ marginLeft: 8 }}>
                    {Math.round(metrics.actual_runtime / runtimeDivisor)}{t('time.minutes')}
                  </Text>
                </Col>
                <Col span={12}>
                  <Text type="secondary">{t('oee.plannedRuntime')}:</Text>
                  <Text strong style={{ marginLeft: 8 }}>
                    {Math.round(metrics.planned_runtime / runtimeDivisor)}{t('time.minutes')}
                  </Text>
                </Col>
                <Col span={12}>
                  <Text type="secondary">{t('oee.outputQuantity')}:</Text>
                  <Text strong style={{ marginLeft: 8 }}>
                    {t('oee.units.quantityValue', { n: metrics.output_qty })}
                  </Text>
                </Col>
                <Col span={12}>
                  <Text type="secondary">{t('oee.defectQuantity')}:</Text>
                  <Text strong style={{ marginLeft: 8 }}>
                    {t('oee.units.quantityValue', { n: metrics.defect_qty })}
                  </Text>
                </Col>
                {/* 평균은 모수를 밝히지 않으면 합계로 오독된다. 게다가 이 카드에서
                    가동시간은 교대 평균이고 수량은 기간 합계라 성격이 다르므로,
                    무엇이 평균인지 명시한다. */}
                {perShiftCount !== null && (
                  <Col span={24}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('oee.perShiftRuntimeNote', { n: perShiftCount })}
                    </Text>
                  </Col>
                )}
              </Row>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};