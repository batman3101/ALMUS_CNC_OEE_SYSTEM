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

ChartJS.register(ArcElement, Tooltip, Legend);

const { Title, Text } = Typography;

interface OEEGaugeProps {
  metrics: OEEMetrics;
  title?: string;
  size?: 'small' | 'default' | 'large';
  showDetails?: boolean;
}

export const OEEGauge: React.FC<OEEGaugeProps> = ({
  metrics,
  title = 'OEE',
  size = 'default',
  showDetails = true
}) => {
  const { availability, performance, quality, oee } = metrics;

  // OEE 수준에 따른 색상 결정
  const getOEEColor = (value: number): string => {
    if (value >= 0.85) return '#52c41a'; // 우수 (녹색)
    if (value >= 0.65) return '#faad14'; // 양호 (주황)
    return '#ff4d4f'; // 개선필요 (빨강)
  };

  // OEE 수준 텍스트
  const getOEELevel = (value: number): string => {
    if (value >= 0.85) return '우수';
    if (value >= 0.65) return '양호';
    return '개선필요';
  };

  // 게이지 차트 데이터
  const gaugeData = {
    datasets: [
      {
        data: [oee * 100, 100 - oee * 100],
        backgroundColor: [getOEEColor(oee), '#f0f0f0'],
        borderWidth: 0,
        cutout: '70%',
      },
    ],
  };

  // 차트 옵션
  const gaugeOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
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
            <div style={{ fontSize: config.valueSize, fontWeight: 'bold', color: getOEEColor(oee) }}>
              {(oee * 100).toFixed(1)}%
            </div>
            <div style={{ fontSize: 14, color: '#666', marginTop: 4 }}>
              {getOEELevel(oee)}
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
                    가동률
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
                    성능
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
                    품질
                  </div>
                </div>
              </Col>
            </Row>

            {/* 추가 정보 */}
            <div style={{ marginTop: 16, textAlign: 'left' }}>
              <Row gutter={[16, 8]}>
                <Col span={12}>
                  <Text type="secondary">실제 가동시간:</Text>
                  <Text strong style={{ marginLeft: 8 }}>
                    {Math.round(metrics.actual_runtime)}분
                  </Text>
                </Col>
                <Col span={12}>
                  <Text type="secondary">계획 가동시간:</Text>
                  <Text strong style={{ marginLeft: 8 }}>
                    {Math.round(metrics.planned_runtime)}분
                  </Text>
                </Col>
                <Col span={12}>
                  <Text type="secondary">생산 수량:</Text>
                  <Text strong style={{ marginLeft: 8 }}>
                    {metrics.output_qty}개
                  </Text>
                </Col>
                <Col span={12}>
                  <Text type="secondary">불량 수량:</Text>
                  <Text strong style={{ marginLeft: 8 }}>
                    {metrics.defect_qty}개
                  </Text>
                </Col>
              </Row>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};