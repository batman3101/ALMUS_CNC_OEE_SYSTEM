'use client';

import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { Select, Space, Checkbox, Card, Row, Col, Divider } from 'antd';

interface MachineComparisonChartProps {
  data: Array<{
    key: string;
    machine: string;
    location: string;
    avgOEE: number;
    availability: number;
    performance: number;
    quality: number;
    downtimeHours: number;
    defectRate: number;
    trend: 'up' | 'down';
    trendValue: number;
  }>;
  height?: number;
  chartType?: 'bar' | 'line';
  onChartTypeChange?: (type: 'bar' | 'line') => void;
  selectedMachines?: string[];
}

const MachineComparisonChart: React.FC<MachineComparisonChartProps> = ({ 
  data, 
  height = 400,
  chartType = 'bar',
  onChartTypeChange,
  selectedMachines = []
}) => {
  // 설비 필터 상태
  const [machineFilter, setMachineFilter] = useState<'all' | 'top10' | 'bottom10' | 'custom'>('top10');
  const [displayCount, setDisplayCount] = useState<number>(10);
  
  // 표시할 지표 체크박스 상태
  const [visibleMetrics, setVisibleMetrics] = useState({
    OEE: true,
    가용성: true,
    성능: true,
    품질: true
  });

  // 설비 필터링 로직
  const chartData = React.useMemo(() => {
    let filteredData = data;
    
    // 설비 필터링
    if (machineFilter === 'top10') {
      filteredData = data.slice().sort((a, b) => b.avgOEE - a.avgOEE).slice(0, displayCount);
    } else if (machineFilter === 'bottom10') {
      filteredData = data.slice().sort((a, b) => a.avgOEE - b.avgOEE).slice(0, displayCount);
    } else if (machineFilter === 'custom' && selectedMachines.length > 0 && !selectedMachines.includes('all')) {
      filteredData = data.filter(item => selectedMachines.includes(item.key));
    } else if (machineFilter === 'all') {
      filteredData = data;
    }
    
    return filteredData.map(item => ({
      name: item.machine,
      OEE: Math.round(item.avgOEE * 100),
      가용성: Math.round(item.availability * 100),
      성능: Math.round(item.performance * 100),
      품질: Math.round(item.quality * 100),
      location: item.location,
      downtimeHours: item.downtimeHours,
      defectRate: Math.round(item.defectRate * 1000) / 10
    }));
  }, [data, selectedMachines, machineFilter, displayCount]);

  const CustomTooltip = ({ active, payload, label }: any) => {
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
          <p style={{ fontSize: '14px', fontWeight: 'bold', margin: '0 0 4px 0' }}>{`설비명: ${label}`}</p>
          <p style={{ fontSize: '14px', margin: '0 0 8px 0', color: '#ccc' }}>{`위치: ${data.location}`}</p>
          <div style={{ margin: '8px 0' }}>
            {payload.map((entry: any, index: number) => (
              <p key={index} style={{ fontSize: '14px', margin: '0 0 4px 0', color: entry.color }}>
                {`${entry.dataKey}: ${entry.value}%`}
              </p>
            ))}
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#aaa' }}>
            <p style={{ margin: '0 0 2px 0' }}>{`다운타임: ${data.downtimeHours}시간`}</p>
            <p style={{ margin: '0' }}>{`불량률: ${data.defectRate}%`}</p>
          </div>
        </div>
      );
    }
    return null;
  };

  const renderChart = () => {
    const commonProps = {
      data: chartData,
      margin: { top: 20, right: 30, left: 20, bottom: 60 }
    };

    if (chartType === 'bar') {
      return (
        <BarChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis 
            dataKey="name" 
            stroke="#666"
            fontSize={12}
            angle={-45}
            textAnchor="end"
            height={80}
            interval={0}
          />
          <YAxis 
            stroke="#666"
            fontSize={12}
            tickFormatter={(value) => `${value}%`}
            domain={[0, 100]}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            wrapperStyle={{ paddingTop: '20px' }}
            iconType="rect"
          />
          {visibleMetrics.OEE && <Bar dataKey="OEE" fill="#ff7875" name="OEE" />}
          {visibleMetrics.가용성 && <Bar dataKey="가용성" fill="#40a9ff" name="가용성" />}
          {visibleMetrics.성능 && <Bar dataKey="성능" fill="#52c41a" name="성능" />}
          {visibleMetrics.품질 && <Bar dataKey="품질" fill="#faad14" name="품질" />}
        </BarChart>
      );
    } else {
      return (
        <LineChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis 
            dataKey="name" 
            stroke="#666"
            fontSize={12}
            angle={-45}
            textAnchor="end"
            height={80}
            interval={0}
          />
          <YAxis 
            stroke="#666"
            fontSize={12}
            tickFormatter={(value) => `${value}%`}
            domain={[0, 100]}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            wrapperStyle={{ paddingTop: '20px' }}
            iconType="line"
          />
          {visibleMetrics.OEE && (
            <Line 
              type="monotone" 
              dataKey="OEE" 
              stroke="#ff7875" 
              strokeWidth={3}
              dot={{ fill: '#ff7875', strokeWidth: 2, r: 5 }}
              name="OEE"
            />
          )}
          {visibleMetrics.가용성 && (
            <Line 
              type="monotone" 
              dataKey="가용성" 
              stroke="#40a9ff" 
              strokeWidth={3}
              dot={{ fill: '#40a9ff', strokeWidth: 2, r: 5 }}
              name="가용성"
            />
          )}
          {visibleMetrics.성능 && (
            <Line 
              type="monotone" 
              dataKey="성능" 
              stroke="#52c41a" 
              strokeWidth={3}
              dot={{ fill: '#52c41a', strokeWidth: 2, r: 5 }}
              name="성능"
            />
          )}
          {visibleMetrics.품질 && (
            <Line 
              type="monotone" 
              dataKey="품질" 
              stroke="#faad14" 
              strokeWidth={3}
              dot={{ fill: '#faad14', strokeWidth: 2, r: 5 }}
              name="품질"
            />
          )}
        </LineChart>
      );
    }
  };

  // 통계 정보 계산
  const statsInfo = React.useMemo(() => {
    if (chartData.length === 0) return null;
    
    const avgOEE = chartData.reduce((sum, item) => sum + item.OEE, 0) / chartData.length;
    const maxOEE = Math.max(...chartData.map(item => item.OEE));
    const minOEE = Math.min(...chartData.map(item => item.OEE));
    const bestMachine = chartData.find(item => item.OEE === maxOEE)?.name || '';
    const worstMachine = chartData.find(item => item.OEE === minOEE)?.name || '';
    
    return {
      avgOEE: avgOEE.toFixed(1),
      maxOEE: maxOEE.toFixed(1),
      minOEE: minOEE.toFixed(1),
      bestMachine,
      worstMachine,
      spread: (maxOEE - minOEE).toFixed(1)
    };
  }, [chartData]);

  return (
    <div style={{ width: '100%', height }}>
      {/* 필터 컨트롤 */}
      <Card 
        size="small" 
        style={{ marginBottom: 16, backgroundColor: 'rgba(255,255,255,0.05)' }}
      >
        <Row gutter={[16, 16]} align="middle">
          <Col span={8}>
            <Space direction="vertical" size={4}>
              <span style={{ fontSize: '12px', color: '#ccc' }}>설비 선택</span>
              <Select
                value={machineFilter}
                onChange={setMachineFilter}
                style={{ width: '100%' }}
                options={[
                  { label: '전체 설비', value: 'all' },
                  { label: '최고 성과 설비', value: 'top10' },
                  { label: '최저 성과 설비', value: 'bottom10' },
                  { label: '사용자 선택', value: 'custom' }
                ]}
              />
            </Space>
          </Col>
          
          {(machineFilter === 'top10' || machineFilter === 'bottom10') && (
            <Col span={4}>
              <Space direction="vertical" size={4}>
                <span style={{ fontSize: '12px', color: '#ccc' }}>표시 개수</span>
                <Select
                  value={displayCount}
                  onChange={setDisplayCount}
                  style={{ width: '100%' }}
                  options={[
                    { label: '5개', value: 5 },
                    { label: '10개', value: 10 },
                    { label: '15개', value: 15 },
                    { label: '20개', value: 20 }
                  ]}
                />
              </Space>
            </Col>
          )}
          
          <Col span={12}>
            <Space direction="vertical" size={4}>
              <span style={{ fontSize: '12px', color: '#ccc' }}>표시 지표</span>
              <Space wrap>
                <Checkbox
                  checked={visibleMetrics.OEE}
                  onChange={(e) => setVisibleMetrics(prev => ({ ...prev, OEE: e.target.checked }))}
                  style={{ color: '#ff7875' }}
                >
                  <span style={{ color: '#ff7875' }}>OEE</span>
                </Checkbox>
                <Checkbox
                  checked={visibleMetrics.가용성}
                  onChange={(e) => setVisibleMetrics(prev => ({ ...prev, 가용성: e.target.checked }))}
                  style={{ color: '#40a9ff' }}
                >
                  <span style={{ color: '#40a9ff' }}>가용성</span>
                </Checkbox>
                <Checkbox
                  checked={visibleMetrics.성능}
                  onChange={(e) => setVisibleMetrics(prev => ({ ...prev, 성능: e.target.checked }))}
                  style={{ color: '#52c41a' }}
                >
                  <span style={{ color: '#52c41a' }}>성능</span>
                </Checkbox>
                <Checkbox
                  checked={visibleMetrics.품질}
                  onChange={(e) => setVisibleMetrics(prev => ({ ...prev, 품질: e.target.checked }))}
                  style={{ color: '#faad14' }}
                >
                  <span style={{ color: '#faad14' }}>품질</span>
                </Checkbox>
              </Space>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 차트 */}
      <div style={{ height: height - 180 }}>
        <ResponsiveContainer>
          {renderChart()}
        </ResponsiveContainer>
      </div>
      
      {/* 요약 통계 */}
      {statsInfo && (
        <div style={{ 
          marginTop: 16, 
          padding: '12px 16px',
          backgroundColor: 'rgba(255,255,255,0.05)',
          borderRadius: '6px',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '12px',
          color: '#ccc'
        }}>
          <div>
            <span style={{ fontWeight: 'bold' }}>평균 OEE:</span>{' '}
            <span style={{ color: '#1890ff', fontWeight: 'bold' }}>{statsInfo.avgOEE}%</span>
          </div>
          <div>
            <span style={{ fontWeight: 'bold' }}>최고 성과:</span>{' '}
            <span style={{ color: '#52c41a', fontWeight: 'bold' }}>
              {statsInfo.bestMachine} ({statsInfo.maxOEE}%)
            </span>
          </div>
          <div>
            <span style={{ fontWeight: 'bold' }}>개선 필요:</span>{' '}
            <span style={{ color: '#ff4d4f', fontWeight: 'bold' }}>
              {statsInfo.worstMachine} ({statsInfo.minOEE}%)
            </span>
          </div>
          <div>
            <span style={{ fontWeight: 'bold' }}>성과 편차:</span>{' '}
            <span style={{ 
              color: parseFloat(statsInfo.spread) > 20 ? '#ff4d4f' : '#faad14', 
              fontWeight: 'bold' 
            }}>
              {statsInfo.spread}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default MachineComparisonChart;