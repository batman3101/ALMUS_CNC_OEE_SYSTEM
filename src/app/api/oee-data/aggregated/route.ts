import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// GET /api/oee-data/aggregated - 집계된 OEE 데이터 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const period = searchParams.get('period') || 'daily'; // daily, weekly, monthly, yearly
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    // 실제 production_records에서 집계 데이터 조회
    const generateRealAggregatedData = async (period: string, machineId: string | null) => {
      let query = supabaseAdmin
        .from('production_records')
        .select('*');

      // 설비 필터
      if (machineId) {
        query = query.eq('machine_id', machineId);
      }

      // 날짜 필터 설정
      const now = new Date();
      const startDate = new Date();
      
      switch (period) {
        case 'daily':
          startDate.setDate(now.getDate() - 30);
          break;
        case 'weekly':
          startDate.setDate(now.getDate() - (12 * 7));
          break;
        case 'monthly':
          startDate.setMonth(now.getMonth() - 12);
          break;
        case 'yearly':
          startDate.setFullYear(now.getFullYear() - 5);
          break;
      }

      query = query.gte('date', startDate.toISOString().split('T')[0]);
      
      const { data: records, error } = await query;
      
      if (error) {
        console.error('Error fetching production records for aggregation:', error);
        return [];
      }

      // 기간별로 데이터 그룹핑 및 집계
      const groupedData = new Map();
      
      (records || []).forEach(record => {
        let periodKey: string;
        const recordDate = new Date(record.date);
        
        switch (period) {
          case 'daily':
            periodKey = record.date;
            break;
          case 'weekly':
            const weekStart = new Date(recordDate);
            weekStart.setDate(recordDate.getDate() - recordDate.getDay());
            periodKey = weekStart.toISOString().split('T')[0];
            break;
          case 'monthly':
            periodKey = `${recordDate.getFullYear()}-${String(recordDate.getMonth() + 1).padStart(2, '0')}`;
            break;
          case 'yearly':
            periodKey = recordDate.getFullYear().toString();
            break;
          default:
            periodKey = record.date;
        }

        if (!groupedData.has(periodKey)) {
          groupedData.set(periodKey, []);
        }
        groupedData.get(periodKey).push(record);
      });

      // 집계 계산
      const aggregatedResults = Array.from(groupedData.entries()).map(([periodKey, records]) => {
        const totalRecords = records.length;
        
        if (totalRecords === 0) {
          return null;
        }

        const avgAvailability = records.reduce((sum: number, r: Record<string, unknown>) => sum + parseFloat(String(r.availability || 0)), 0) / totalRecords;
        const avgPerformance = records.reduce((sum: number, r: Record<string, unknown>) => sum + parseFloat(String(r.performance || 0)), 0) / totalRecords;
        const avgQuality = records.reduce((sum: number, r: Record<string, unknown>) => sum + parseFloat(String(r.quality || 0)), 0) / totalRecords;
        const avgOEE = records.reduce((sum: number, r: Record<string, unknown>) => sum + parseFloat(String(r.oee || 0)), 0) / totalRecords;

        const totalOutput = records.reduce((sum: number, r: Record<string, unknown>) => sum + (Number(r.output_qty) || 0), 0);
        const totalDefects = records.reduce((sum: number, r: Record<string, unknown>) => sum + (Number(r.defect_qty) || 0), 0);
        const totalRuntime = records.reduce((sum: number, r: Record<string, unknown>) => sum + (Number(r.actual_runtime) || 0), 0);
        const plannedRuntime = records.reduce((sum: number, r: Record<string, unknown>) => sum + (Number(r.planned_runtime) || 480), 0);

        // 라벨 생성
        let label: string;
        switch (period) {
          case 'daily':
            label = new Date(periodKey).toLocaleDateString('ko-KR');
            break;
          case 'weekly':
            const weekDate = new Date(periodKey);
            label = `${weekDate.getFullYear()}년 ${Math.floor(weekDate.getMonth() / 3) + 1}분기`;
            break;
          case 'monthly':
            const [year, month] = periodKey.split('-');
            label = `${year}년 ${month}월`;
            break;
          case 'yearly':
            label = `${periodKey}년`;
            break;
          default:
            label = periodKey;
        }

        return {
          period: periodKey,
          label,
          machine_id: machineId || 'all',
          availability: Math.round(avgAvailability * 1000) / 1000,
          performance: Math.round(avgPerformance * 1000) / 1000,
          quality: Math.round(avgQuality * 1000) / 1000,
          oee: Math.round(avgOEE * 1000) / 1000,
          total_output: totalOutput,
          total_defects: totalDefects,
          total_runtime: totalRuntime,
          planned_runtime: plannedRuntime,
        };
      }).filter(Boolean);

      // 시간순 정렬
      return aggregatedResults.sort((a, b) => {
        if (period === 'yearly') {
          return parseInt(a.period) - parseInt(b.period);
        }
        return a.period.localeCompare(b.period);
      });
    };

    const aggregatedData = await generateRealAggregatedData(period, machineId);

    // 트렌드 분석
    const calculateTrend = (data: Record<string, unknown>[], key: string) => {
      if (data.length < 2) return 0;
      
      const recent = data.slice(0, Math.ceil(data.length / 2));
      const older = data.slice(Math.ceil(data.length / 2));
      
      const recentAvg = recent.reduce((sum, item) => sum + (typeof item[key] === 'number' ? item[key] : 0), 0) / recent.length;
      const olderAvg = older.reduce((sum, item) => sum + (typeof item[key] === 'number' ? item[key] : 0), 0) / older.length;
      
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