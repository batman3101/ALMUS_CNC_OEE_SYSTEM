import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/oee-data/aggregated - 집계된 OEE 데이터 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const period = searchParams.get('period') || 'daily'; // daily, weekly, monthly, yearly
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    // 집계 기간에 따른 데이터 생성
    const generateAggregatedData = (period: string) => {
      let periods = [];
      const now = new Date();
      
      switch (period) {
        case 'daily':
          // 지난 30일
          for (let i = 0; i < 30; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            periods.push({
              period: date.toISOString().split('T')[0],
              label: date.toLocaleDateString('ko-KR'),
            });
          }
          break;
          
        case 'weekly':
          // 지난 12주
          for (let i = 0; i < 12; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - (i * 7));
            const weekStart = new Date(date);
            weekStart.setDate(date.getDate() - date.getDay());
            periods.push({
              period: weekStart.toISOString().split('T')[0],
              label: `${weekStart.getFullYear()}년 ${Math.ceil(weekStart.getMonth() / 3)}분기`,
            });
          }
          break;
          
        case 'monthly':
          // 지난 12개월
          for (let i = 0; i < 12; i++) {
            const date = new Date(now);
            date.setMonth(date.getMonth() - i);
            periods.push({
              period: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
              label: `${date.getFullYear()}년 ${date.getMonth() + 1}월`,
            });
          }
          break;
          
        case 'yearly':
          // 지난 5년
          for (let i = 0; i < 5; i++) {
            const year = now.getFullYear() - i;
            periods.push({
              period: year.toString(),
              label: `${year}년`,
            });
          }
          break;
      }
      
      return periods.map(p => {
        const availability = 0.75 + Math.random() * 0.2;
        const performance = 0.80 + Math.random() * 0.15;
        const quality = 0.90 + Math.random() * 0.08;
        const oee = availability * performance * quality;
        
        return {
          period: p.period,
          label: p.label,
          machine_id: machineId || 'all',
          availability: Math.round(availability * 1000) / 1000,
          performance: Math.round(performance * 1000) / 1000,
          quality: Math.round(quality * 1000) / 1000,
          oee: Math.round(oee * 1000) / 1000,
          total_output: 1000 + Math.floor(Math.random() * 500),
          total_defects: Math.floor(Math.random() * 50),
          total_runtime: 400 + Math.floor(Math.random() * 100),
          planned_runtime: 500,
        };
      });
    };

    const aggregatedData = generateAggregatedData(period);

    // 트렌드 분석
    const calculateTrend = (data: any[], key: string) => {
      if (data.length < 2) return 0;
      
      const recent = data.slice(0, Math.ceil(data.length / 2));
      const older = data.slice(Math.ceil(data.length / 2));
      
      const recentAvg = recent.reduce((sum, item) => sum + item[key], 0) / recent.length;
      const olderAvg = older.reduce((sum, item) => sum + item[key], 0) / older.length;
      
      return ((recentAvg - olderAvg) / olderAvg) * 100;
    };

    const trends = {
      oee: calculateTrend(aggregatedData, 'oee'),
      availability: calculateTrend(aggregatedData, 'availability'),
      performance: calculateTrend(aggregatedData, 'performance'),
      quality: calculateTrend(aggregatedData, 'quality'),
    };

    // 전체 통계
    const totalRecords = aggregatedData.length;
    const overallStats = {
      avg_oee: aggregatedData.reduce((sum, data) => sum + data.oee, 0) / totalRecords,
      avg_availability: aggregatedData.reduce((sum, data) => sum + data.availability, 0) / totalRecords,
      avg_performance: aggregatedData.reduce((sum, data) => sum + data.performance, 0) / totalRecords,
      avg_quality: aggregatedData.reduce((sum, data) => sum + data.quality, 0) / totalRecords,
      total_output: aggregatedData.reduce((sum, data) => sum + data.total_output, 0),
      total_defects: aggregatedData.reduce((sum, data) => sum + data.total_defects, 0),
      total_runtime: aggregatedData.reduce((sum, data) => sum + data.total_runtime, 0),
    };

    return NextResponse.json({
      aggregated_data: aggregatedData.reverse(), // 시간순 정렬
      trends: Object.fromEntries(
        Object.entries(trends).map(([key, value]) => [key, Math.round(value * 100) / 100])
      ),
      statistics: {
        ...Object.fromEntries(
          Object.entries(overallStats).map(([key, value]) => 
            [key, typeof value === 'number' ? Math.round(value * 1000) / 1000 : value]
          )
        ),
        period_count: totalRecords,
      },
      metadata: {
        period,
        machine_id: machineId || 'all',
        start_date: startDate,
        end_date: endDate,
        generated_at: new Date().toISOString(),
      }
    });
  } catch (error) {
    console.error('Error fetching aggregated OEE data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch aggregated OEE data' },
      { status: 500 }
    );
  }
}