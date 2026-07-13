import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * analytics_oee_daily RPC 가 돌려주는 "일 단위" 사전집계 행.
 *
 * 이전에는 이 라우트가 production_records 를 `.select('*')` 로 전부 가져와
 * (30일 전체 설비 기준 약 37,000행 / 13MB) Node 의 Map 으로 그룹핑했다.
 * 이제 DB 가 일 단위까지 집계해 주고, 라우트는 그 결과를 기간(주/월/년)으로
 * 롤업하기만 한다. 기간 키 산출과 라벨 생성이 로컬 타임존에 의존하는
 * Date 연산이라 그 부분은 의도적으로 Node 에 남겨 동작을 그대로 보존한다.
 */
interface DailyAggregateRow {
  date: string;
  records_count: number;
  sum_availability: number;
  sum_performance: number;
  sum_quality: number;
  sum_oee: number;
  total_output: number;
  total_defects: number;
  total_runtime: number;
  planned_runtime: number;
}

/** 기간(일/주/월/년) 단위로 누적한 합계 */
interface PeriodBucket {
  records_count: number;
  sum_availability: number;
  sum_performance: number;
  sum_quality: number;
  sum_oee: number;
  total_output: number;
  total_defects: number;
  total_runtime: number;
  planned_runtime: number;
}

interface AggregatedPeriod {
  period: string;
  label: string;
  machine_id: string;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  total_output: number;
  total_defects: number;
  total_runtime: number;
  planned_runtime: number;
}

type TrendKey = 'oee' | 'availability' | 'performance' | 'quality';

const emptyBucket = (): PeriodBucket => ({
  records_count: 0,
  sum_availability: 0,
  sum_performance: 0,
  sum_quality: 0,
  sum_oee: 0,
  total_output: 0,
  total_defects: 0,
  total_runtime: 0,
  planned_runtime: 0,
});

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
      // 날짜 필터 설정 (start_date/end_date 파라미터는 기존과 동일하게 메타데이터에만 반영된다)
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

      // 집계는 DB에서 수행한다.
      const { data, error } = await supabaseAdmin.rpc('analytics_oee_daily', {
        p_start_date: startDate.toISOString().split('T')[0],
        p_machine_id: machineId,
      });

      if (error) {
        console.error('Error fetching production records for aggregation:', error);
        return [];
      }

      const dailyRows = (data ?? []) as DailyAggregateRow[];

      // 일 단위 집계를 기간별로 그룹핑
      const groupedData = new Map<string, PeriodBucket>();

      dailyRows.forEach(row => {
        let periodKey: string;
        const recordDate = new Date(row.date);

        switch (period) {
          case 'daily':
            periodKey = row.date;
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
            periodKey = row.date;
        }

        const bucket = groupedData.get(periodKey) ?? emptyBucket();
        bucket.records_count += row.records_count;
        bucket.sum_availability += row.sum_availability;
        bucket.sum_performance += row.sum_performance;
        bucket.sum_quality += row.sum_quality;
        bucket.sum_oee += row.sum_oee;
        bucket.total_output += row.total_output;
        bucket.total_defects += row.total_defects;
        bucket.total_runtime += row.total_runtime;
        bucket.planned_runtime += row.planned_runtime;
        groupedData.set(periodKey, bucket);
      });

      // 집계 계산
      const aggregatedResults: AggregatedPeriod[] = Array.from(groupedData.entries()).map(([periodKey, bucket]) => {
        const totalRecords = bucket.records_count;

        const avgAvailability = bucket.sum_availability / totalRecords;
        const avgPerformance = bucket.sum_performance / totalRecords;
        const avgQuality = bucket.sum_quality / totalRecords;
        const avgOEE = bucket.sum_oee / totalRecords;

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
          total_output: bucket.total_output,
          total_defects: bucket.total_defects,
          total_runtime: bucket.total_runtime,
          planned_runtime: bucket.planned_runtime,
        };
      });

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
    const calculateTrend = (data: AggregatedPeriod[], key: TrendKey) => {
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
