'use client';

import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { List, Space, Tag } from 'antd';

interface DefectTypeAnalysisChartProps {
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
}

const DefectTypeAnalysisChart: React.FC<DefectTypeAnalysisChartProps> = ({ 
  data, 
  height = 300
}) => {
  // 불량 유형별 모의 데이터 생성 (실제로는 API에서 가져와야 함)
  const defectTypeData = React.useMemo(() => {
    const totalDefects = data.reduce((sum, item) => sum + item.defect_qty, 0);
    
    // 일반적인 CNC 가공에서 발생하는 불량 유형들
    const defectTypes = [
      { name: '치수 불량', value: Math.floor(totalDefects * 0.35), color: '#ff4d4f' },
      { name: '표면 불량', value: Math.floor(totalDefects * 0.25), color: '#ff7a45' },
      { name: '형상 불량', value: Math.floor(totalDefects * 0.20), color: '#ffa940' },
      { name: '재질 불량', value: Math.floor(totalDefects * 0.12), color: '#ffec3d' },
      { name: '기타', value: Math.floor(totalDefects * 0.08), color: '#bae637' }
    ];

    // 남은 수량을 첫 번째 항목에 추가
    const calculatedTotal = defectTypes.reduce((sum, item) => sum + item.value, 0);
    if (calculatedTotal < totalDefects) {
      defectTypes[0].value += (totalDefects - calculatedTotal);
    }

    return defectTypes.filter(item => item.value > 0);
  }, [data]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      const total = defectTypeData.reduce((sum, item) => sum + item.value, 0);
      const percentage = ((data.value / total) * 100).toFixed(1);
      
      return (
        <div style={{ 
          backgroundColor: '#1f1f1f', 
          color: 'white',
          padding: '12px',
          border: '1px solid #444',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          <p style={{ fontSize: '14px', fontWeight: 'bold', margin: '0 0 4px 0' }}>{data.name}</p>
          <p style={{ fontSize: '14px', margin: '0 0 4px 0' }}>수량: {data.value}개</p>
          <p style={{ fontSize: '14px', margin: '0' }}>비율: {percentage}%</p>
        </div>
      );
    }
    return null;
  };

  const CustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    if (percent < 0.05) return null; // 5% 미만은 레이블 숨김
    
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text 
        x={x} 
        y={y} 
        fill="black" 
        textAnchor={x > cx ? 'start' : 'end'} 
        dominantBaseline="central"
        fontSize="12"
        fontWeight="bold"
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <div style={{ width: '100%', height }}>
      <div style={{ display: 'flex', height: '100%' }}>
        {/* 파이 차트 */}
        <div style={{ flex: 1 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={defectTypeData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={CustomLabel}
                outerRadius={80}
                innerRadius={30}
                fill="#8884d8"
                dataKey="value"
                startAngle={90}
                endAngle={450}
              >
                {defectTypeData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* 범례 및 상세 정보 */}
        <div style={{ width: '180px', padding: '0 16px' }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: 8 }}>
              불량 유형별 현황
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              전체 불량: {defectTypeData.reduce((sum, item) => sum + item.value, 0)}개
            </div>
          </div>

          <List
            size="small"
            dataSource={defectTypeData}
            renderItem={(item, index) => {
              const total = defectTypeData.reduce((sum, entry) => sum + entry.value, 0);
              const percentage = ((item.value / total) * 100).toFixed(1);
              
              return (
                <List.Item style={{ padding: '4px 0', border: 'none' }}>
                  <div style={{ width: '100%' }}>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      marginBottom: 4
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <div 
                          style={{ 
                            width: 12, 
                            height: 12, 
                            backgroundColor: item.color,
                            marginRight: 8,
                            borderRadius: '2px'
                          }} 
                        />
                        <span style={{ fontSize: '12px' }}>{item.name}</span>
                      </div>
                      <Tag 
                        color={item.color} 
                        size="small"
                        style={{ color: 'black', fontWeight: 'bold' }}
                      >
                        {percentage}%
                      </Tag>
                    </div>
                    <div style={{ 
                      fontSize: '11px', 
                      color: '#666',
                      marginLeft: 20
                    }}>
                      {item.value}개
                    </div>
                  </div>
                </List.Item>
              );
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default DefectTypeAnalysisChart;