'use client';

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  TooltipContentProps,
} from 'recharts';
import { Card, Typography, Empty, Spin } from 'antd';
import { useDashboardTranslation } from '@/hooks/useTranslation';

const { Title: AntTitle } = Typography;

interface QualityTrendData {
  date: string;
  defect_rate: number;
  total_output: number;
  defect_qty: number;
}

interface QualityTrendChartProps {
  data: QualityTrendData[];
  title?: string;
  height?: number;
  loading?: boolean;
  error?: string;
}

// 커스텀 툴팁 컴포넌트
const CustomTooltip: React.FC<TooltipContentProps<number, string>> = ({ active, payload, label }) => {
  const { t } = useDashboardTranslation();
  if (active && payload && payload.length) {
    const data = payload[0].payload as QualityTrendData;
    return (
      <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
        <p className="font-medium text-gray-800 mb-2">{`${t('qualityChart.date')}: ${label}`}</p>
        <div className="space-y-1">
          <p className="text-sm">
            <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ backgroundColor: '#ff4d4f' }}></span>
            {t('qualityChart.defectRate')}: {data.defect_rate.toFixed(2)}%
          </p>
          <p className="text-sm text-gray-600">
            {t('qualityChart.totalOutput')}: {data.total_output.toLocaleString()}{t('chart.unit')}
          </p>
          <p className="text-sm text-gray-600">
            {t('qualityChart.defectQty')}: {data.defect_qty.toLocaleString()}{t('chart.unit')}
          </p>
        </div>
      </div>
    );
  }
  return null;
};

// Y축 라벨 포맷팅
const formatYAxisLabel = (value: number) => `${value.toFixed(1)}%`;

// X축 라벨 포맷팅 (날짜)
const formatXAxisLabel = (dateString: string) => {
  const date = new Date(dateString);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

export const QualityTrendChart: React.FC<QualityTrendChartProps> = ({
  data,
  title,
  height = 400,
  loading = false,
  error
}) => {
  const { t } = useDashboardTranslation();
  const displayTitle = title ?? t('chart.defectRateTrend');

  // 데이터 로깅 (디버깅용)
  React.useEffect(() => {
    console.log('QualityTrendChart 받은 데이터:', { 
      dataLength: data.length, 
      sampleData: data.slice(0, 3),
      title 
    });
  }, [data, title]);


  // 통계 계산
  const statistics = React.useMemo(() => {
    if (data.length === 0) {
      return {
        average: 0,
        highest: 0,
        lowest: 0,
        totalDefects: 0,
        totalOutput: 0
      };
    }

    const defectRates = data.map(item => item.defect_rate);
    const totalDefects = data.reduce((sum, item) => sum + item.defect_qty, 0);
    const totalOutput = data.reduce((sum, item) => sum + item.total_output, 0);
    
    return {
      average: defectRates.reduce((sum, rate) => sum + rate, 0) / defectRates.length,
      highest: Math.max(...defectRates),
      lowest: Math.min(...defectRates),
      totalDefects,
      totalOutput
    };
  }, [data]);

  // 로딩 상태
  if (loading) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <Spin size="large" />
          <p style={{ marginTop: 16, color: '#666' }}>{t('charts.loadingData')}</p>
        </div>
      </Card>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <p style={{ color: '#ff4d4f', marginBottom: 16 }}>{t('charts.dataLoadErrorMessage')}</p>
          <p style={{ color: '#666', fontSize: '14px' }}>{error}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      {/* 제목 */}
      <div style={{ marginBottom: 16 }}>
        <AntTitle level={4} style={{ margin: 0 }}>
          {displayTitle}
        </AntTitle>
      </div>

      {/* 차트 */}
      {data.length === 0 ? (
        <div style={{ height }}>
          <Empty
            description={t('charts.noDataInPeriod')}
            style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              justifyContent: 'center', 
              alignItems: 'center',
              height: '100%'
            }}
          />
        </div>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{
                top: 20,
                right: 30,
                left: 20,
                bottom: 20,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.1)" />
              <XAxis
                dataKey="date"
                tickFormatter={formatXAxisLabel}
                stroke="#666"
                fontSize={12}
              />
              <YAxis
                tickFormatter={formatYAxisLabel}
                stroke="#666"
                fontSize={12}
                domain={[0, 'dataMax + 1']}
              />
              <Tooltip content={CustomTooltip} />
              <Legend
                wrapperStyle={{
                  paddingTop: '20px',
                }}
              />
              <Line
                type="monotone"
                dataKey="defect_rate"
                stroke="#ff4d4f"
                strokeWidth={3}
                dot={{
                  fill: '#ff4d4f',
                  strokeWidth: 2,
                  r: 4,
                }}
                activeDot={{
                  r: 6,
                  stroke: '#ff4d4f',
                  strokeWidth: 2,
                  fill: '#fff',
                }}
                name={t('chart.defectRatePercent')}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 통계 요약 */}
      {data.length > 0 && (
        <div style={{ marginTop: 16, padding: '16px 0', borderTop: '1px solid #f0f0f0' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 32, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1890ff' }}>
                {statistics.average.toFixed(2)}%
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>{t('qualityChart.avgDefectRate')}</div>
            </div>
            
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#ff4d4f' }}>
                {statistics.highest.toFixed(2)}%
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>{t('qualityChart.maxDefectRate')}</div>
            </div>
            
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#52c41a' }}>
                {statistics.lowest.toFixed(2)}%
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>{t('qualityChart.minDefectRate')}</div>
            </div>
            
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#722ed1' }}>
                {statistics.totalDefects.toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>{t('qualityChart.totalDefectQty')}</div>
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#faad14' }}>
                {statistics.totalOutput.toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>{t('qualityChart.totalOutput')}</div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};