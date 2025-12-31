'use client';

import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useTranslation } from '@/hooks/useTranslation';

interface DefectRateTrendChartProps {
  data: Array<{
    date: string;
    output_qty: number;
    defect_qty: number;
    good_qty: number;
    defect_rate: number;
    target_qty: number;
    shift: 'A' | 'B' | 'C' | 'D';
  }>;
  height?: number;
  period?: 'week' | 'month' | 'quarter';
}

const DefectRateTrendChart: React.FC<DefectRateTrendChartProps> = ({
  data,
  height = 300,
  period = 'month'
}) => {
  const { t } = useTranslation();

  const chartData = data.map(item => ({
    date: item.date,
    defectRate: (item.defect_rate * 100), // 백분율로 변환
    shift: item.shift,
    defectQty: item.defect_qty,
    outputQty: item.output_qty
  }));

  // 목표 불량률 (일반적으로 2% 이하)
  const targetDefectRate = 2.0;

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: { shift: string; defectRate: number; defectQty: number; outputQty: number }; color: string }>; label?: string }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div style={{
          backgroundColor: '#1f1f1f',
          color: 'white',
          padding: '12px',
          border: '1px solid #444',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          <p style={{ fontSize: '14px', fontWeight: 'bold', margin: '0 0 4px 0' }}>
            {t('dashboard:qualityChart.date')}: {label}
          </p>
          <p style={{ fontSize: '14px', margin: '0 0 4px 0' }}>
            {t('dashboard:qualityChart.shift')}: {data.shift}
          </p>
          <p style={{ fontSize: '14px', margin: '0 0 4px 0', color: payload[0].color }}>
            {t('dashboard:qualityChart.defectRate')}: {data.defectRate.toFixed(2)}%
          </p>
          <p style={{ fontSize: '14px', margin: '0 0 4px 0', color: '#ccc' }}>
            {t('dashboard:qualityChart.defectQty')}: {data.defectQty}{t('dashboard:chart.unit')}
          </p>
          <p style={{ fontSize: '14px', margin: '0', color: '#ccc' }}>
            {t('dashboard:qualityChart.totalOutput')}: {data.outputQty}{t('dashboard:chart.unit')}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ width: '100%', height, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="date" 
              stroke="#666"
              fontSize={12}
              tickFormatter={(value) => {
                const date = new Date(value);
                return period === 'week' ? 
                  date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) :
                  date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
              }}
            />
            <YAxis 
              stroke="#666"
              fontSize={12}
              tickFormatter={(value) => `${value}%`}
              domain={[0, 'dataMax + 1']}
            />
            <Tooltip content={<CustomTooltip />} />
            
            {/* 목표 불량률 기준선 */}
            <ReferenceLine
              y={targetDefectRate}
              stroke="#ff4d4f"
              strokeDasharray="5 5"
              label={{ value: t('dashboard:qualityChart.targetDefectRate'), position: "topRight" }}
            />
            
            <Line
              type="monotone"
              dataKey="defectRate"
              stroke="#ff7875"
              strokeWidth={2}
              dot={{ fill: '#ff4d4f', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, stroke: '#ff4d4f', strokeWidth: 2 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      {/* 요약 정보 - 차트 컨테이너 내부로 이동 */}
      <div style={{
        padding: '12px 16px',
        display: 'flex',
        justifyContent: 'space-around',
        fontSize: '12px',
        color: '#ccc',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        <div>
          <span style={{ fontWeight: 'bold' }}>{t('dashboard:qualityChart.avgDefectRate')}:</span>{' '}
          <span style={{
            color: chartData.reduce((sum, item) => sum + item.defectRate, 0) / chartData.length > targetDefectRate ? '#ff4d4f' : '#52c41a'
          }}>
            {(chartData.reduce((sum, item) => sum + item.defectRate, 0) / chartData.length).toFixed(2)}%
          </span>
        </div>
        <div>
          <span style={{ fontWeight: 'bold' }}>{t('dashboard:qualityChart.maxDefectRate')}:</span>{' '}
          <span style={{ color: '#ff4d4f' }}>
            {Math.max(...chartData.map(item => item.defectRate)).toFixed(2)}%
          </span>
        </div>
        <div>
          <span style={{ fontWeight: 'bold' }}>{t('dashboard:qualityChart.minDefectRate')}:</span>{' '}
          <span style={{ color: '#52c41a' }}>
            {Math.min(...chartData.map(item => item.defectRate)).toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
};

export default DefectRateTrendChart;