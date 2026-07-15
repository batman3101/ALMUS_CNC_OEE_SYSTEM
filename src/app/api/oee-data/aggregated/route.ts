import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';
import { calculateWeightedOEE } from '@/utils/weightedOee';
import {
  calculateChronologicalTrend,
  isoWeek,
  isValidDateOnly,
  sortPeriodsChronologically,
  type AggregationPeriod,
} from './aggregationRules';

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
  reported_records: number;
  unreported_records: number;
  invalid_records: number;
  total_planned_runtime: number;
  total_actual_runtime: number;
  total_ideal_runtime: number;
  metric_output: number;
  metric_defects: number;
  total_output: number;
  total_defects: number;
}

/** 기간(일/주/월/년) 단위로 누적한 합계 */
interface PeriodBucket {
  records_count: number;
  reported_records: number;
  unreported_records: number;
  invalid_records: number;
  total_planned_runtime: number;
  total_actual_runtime: number;
  total_ideal_runtime: number;
  metric_output: number;
  metric_defects: number;
  total_output: number;
  total_defects: number;
}

interface AggregatedPeriod {
  period: string;
  label: string;
  machine_id: string;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  total_output: number;
  total_defects: number;
  total_runtime: number;
  planned_runtime: number;
  ideal_runtime: number;
  metric_output: number;
  metric_defects: number;
  records_count: number;
  reported_records: number;
  unreported_records: number;
  invalid_records: number;
}

const round3 = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 1000) / 1000;

const PERIODS: AggregationPeriod[] = ['daily', 'weekly', 'monthly', 'yearly'];

const emptyBucket = (): PeriodBucket => ({
  records_count: 0,
  reported_records: 0,
  unreported_records: 0,
  invalid_records: 0,
  total_planned_runtime: 0,
  total_actual_runtime: 0,
  total_ideal_runtime: 0,
  metric_output: 0,
  metric_defects: 0,
  total_output: 0,
  total_defects: 0,
});

// GET /api/oee-data/aggregated - 집계된 OEE 데이터 조회
export async function GET(request: NextRequest) {
  try {
    await requireUser(request, ['admin', 'engineer']);
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const requestedPeriod = searchParams.get('period') || 'daily';
    const requestedStartDate = searchParams.get('start_date');
    const requestedEndDate = searchParams.get('end_date');

    if (!PERIODS.includes(requestedPeriod as AggregationPeriod)) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 });
    }
    if ((requestedStartDate === null) !== (requestedEndDate === null)) {
      return NextResponse.json({ error: 'start_date and end_date must be provided together' }, { status: 400 });
    }
    if (requestedStartDate && requestedEndDate && (
      !isValidDateOnly(requestedStartDate)
      || !isValidDateOnly(requestedEndDate)
      || requestedStartDate > requestedEndDate
    )) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
    }
    const period = requestedPeriod as AggregationPeriod;

    // 실제 production_records에서 집계 데이터 조회
    const generateRealAggregatedData = async (period: AggregationPeriod, machineId: string | null) => {
      // 사용자 지정 범위가 있으면 그 범위를 그대로 사용한다.
      const now = new Date();
      const defaultStart = new Date();

      switch (period) {
        case 'daily':
          defaultStart.setDate(now.getDate() - 30);
          break;
        case 'weekly':
          defaultStart.setDate(now.getDate() - (12 * 7));
          break;
        case 'monthly':
          defaultStart.setMonth(now.getMonth() - 12);
          break;
        case 'yearly':
          defaultStart.setFullYear(now.getFullYear() - 5);
          break;
      }
      const effectiveStartDate = requestedStartDate ?? defaultStart.toISOString().split('T')[0];
      const effectiveEndDate = requestedEndDate ?? now.toISOString().split('T')[0];

      // 집계는 DB에서 수행한다.
      const { data, error } = await supabaseAdmin.rpc('analytics_oee_daily', {
        p_start_date: effectiveStartDate,
        p_machine_id: machineId,
      });

      if (error) {
        console.error('Error fetching production records for aggregation:', error);
        throw new Error(`Failed to aggregate OEE: ${error.message}`);
      }

      const dailyRows = ((data ?? []) as DailyAggregateRow[])
        .filter(row => row.date >= effectiveStartDate && row.date <= effectiveEndDate);

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
            periodKey = isoWeek(row.date).key;
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
        bucket.reported_records += row.reported_records;
        bucket.unreported_records += row.unreported_records;
        bucket.invalid_records += row.invalid_records;
        bucket.total_planned_runtime += row.total_planned_runtime;
        bucket.total_actual_runtime += row.total_actual_runtime;
        bucket.total_ideal_runtime += row.total_ideal_runtime;
        bucket.metric_output += row.metric_output;
        bucket.metric_defects += row.metric_defects;
        bucket.total_output += row.total_output;
        bucket.total_defects += row.total_defects;
        groupedData.set(periodKey, bucket);
      });

      // 집계 계산
      const aggregatedResults: AggregatedPeriod[] = Array.from(groupedData.entries()).map(([periodKey, bucket]) => {
        const weighted = calculateWeightedOEE({
          reportedRecords: bucket.reported_records,
          totalPlannedRuntime: bucket.total_planned_runtime,
          totalActualRuntime: bucket.total_actual_runtime,
          totalIdealRuntime: bucket.total_ideal_runtime,
          totalOutput: bucket.metric_output,
          totalDefects: bucket.metric_defects,
        });

        // 라벨 생성
        let label: string;
        switch (period) {
          case 'daily':
            label = new Date(periodKey).toLocaleDateString('ko-KR');
            break;
          case 'weekly':
            const [isoYear, isoWeekNumber] = periodKey.split('-W');
            label = `${isoYear}년 ${Number(isoWeekNumber)}주`;
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
          availability: round3(weighted.availability),
          performance: round3(weighted.performance),
          quality: round3(weighted.quality),
          oee: round3(weighted.oee),
          total_output: bucket.total_output,
          total_defects: bucket.total_defects,
          total_runtime: bucket.total_actual_runtime,
          planned_runtime: bucket.total_planned_runtime,
          ideal_runtime: bucket.total_ideal_runtime,
          metric_output: bucket.metric_output,
          metric_defects: bucket.metric_defects,
          records_count: bucket.records_count,
          reported_records: bucket.reported_records,
          unreported_records: bucket.unreported_records,
          invalid_records: bucket.invalid_records,
        };
      });

      // 시간순 정렬
      return sortPeriodsChronologically(aggregatedResults);
    };

    const aggregatedData = await generateRealAggregatedData(period, machineId);

    // 트렌드 분석
    const trends = {
      oee: calculateChronologicalTrend(aggregatedData, 'oee'),
      availability: calculateChronologicalTrend(aggregatedData, 'availability'),
      performance: calculateChronologicalTrend(aggregatedData, 'performance'),
      quality: calculateChronologicalTrend(aggregatedData, 'quality'),
    };

    // 전체 통계
    const totals = aggregatedData.reduce((sum, data) => ({
      records: sum.records + data.records_count,
      reported: sum.reported + data.reported_records,
      unreported: sum.unreported + data.unreported_records,
      invalid: sum.invalid + data.invalid_records,
      planned: sum.planned + data.planned_runtime,
      actual: sum.actual + data.total_runtime,
      ideal: sum.ideal + data.ideal_runtime,
      metricOutput: sum.metricOutput + data.metric_output,
      metricDefects: sum.metricDefects + data.metric_defects,
      output: sum.output + data.total_output,
      defects: sum.defects + data.total_defects,
    }), {
      records: 0, reported: 0, unreported: 0, invalid: 0, planned: 0, actual: 0,
      ideal: 0, metricOutput: 0, metricDefects: 0, output: 0, defects: 0,
    });
    const overall = calculateWeightedOEE({
      reportedRecords: totals.reported,
      totalPlannedRuntime: totals.planned,
      totalActualRuntime: totals.actual,
      totalIdealRuntime: totals.ideal,
      totalOutput: totals.metricOutput,
      totalDefects: totals.metricDefects,
    });
    const totalRecords = aggregatedData.length;
    const overallStats = {
      avg_oee: overall.oee,
      avg_availability: overall.availability,
      avg_performance: overall.performance,
      avg_quality: overall.quality,
      total_output: totals.output,
      total_defects: totals.defects,
      total_runtime: totals.actual,
      records_count: totals.records,
      reported_records: totals.reported,
      unreported_records: totals.unreported,
      invalid_records: totals.invalid,
    };

    return NextResponse.json({
      aggregated_data: aggregatedData,
      trends: Object.fromEntries(
        Object.entries(trends).map(([key, value]) => [
          key,
          value === null ? null : Math.round(value * 100) / 100,
        ])
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
        start_date: requestedStartDate,
        end_date: requestedEndDate,
        generated_at: new Date().toISOString(),
      }
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error fetching aggregated OEE data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch aggregated OEE data' },
      { status: 500 }
    );
  }
}
