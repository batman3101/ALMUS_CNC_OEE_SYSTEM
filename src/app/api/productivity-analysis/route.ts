import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  buildPaginationMeta,
  parseIntParam,
  type PaginationMeta,
} from '@/lib/pagination';
import { unwrapJoin } from '@/types';
import { calculateWeightedOEE } from '@/utils/weightedOee';

export const dynamic = 'force-dynamic';

/**
 * 집계는 analytics_productivity() RPC(Postgres)에서 수행한다.
 *
 * 이전에는 production_records 원본 행을 전부 가져와(30일 전체 설비 기준 46,608행 / 약 16MB)
 * JS 루프로 집계했다. 이제 DB 가 설비별·교대별·일별 사전집계만 돌려주므로
 * 전송량이 수천 행 수준으로 줄어든다.
 *
 * 합계는 float8 로, 그것도 기존 라우트가 순회하던 행 순서(date DESC)와 동일한 순서로
 * 누적해서 돌려준다. 부동소수점 덧셈은 결합법칙이 성립하지 않아 누적 순서가 마지막
 * 비트를 바꾸는데, 그 마지막 비트가 정렬 순서를 가르는 경우가 실제로 있기 때문이다
 * (A/B 교대의 oee 합계는 numeric 기준 완전히 동일하고 float64 오차로만 갈린다).
 * 각 그룹의 first_rn(최초 등장 행 번호)은 동률일 때의 안정 정렬 순서를 복원하는 데 쓴다.
 *
 * 스케일: availability/performance/quality/oee 는 DB와 동일하게 0~1 비율이다.
 */
interface ProductivityMachineRow {
  machine_id: string;
  machine_name: string;
  equipment_type: string;
  records_count: number;
  reported_records: number;
  unreported_records: number;
  invalid_records: number;
  total_output: number;
  total_defect_qty: number;
  total_good_qty: number;
  reported_output: number;
  reported_defect_qty: number;
  total_planned_runtime: number;
  total_actual_runtime: number;
  total_ideal_runtime: number;
  best_shift: string | null;
  worst_shift: string | null;
  first_rn: number;
}

interface ProductivityShiftRow {
  shift: string;
  records_count: number;
  reported_records: number;
  unreported_records: number;
  invalid_records: number;
  total_planned_runtime: number;
  total_actual_runtime: number;
  total_ideal_runtime: number;
  total_output: number;
  total_defect_qty: number;
  total_good_qty: number;
  reported_output: number;
  reported_defect_qty: number;
  machines_count: number;
  first_rn: number;
}

interface ProductivityDailyRow {
  date: string;
  records_count: number;
  reported_records: number;
  unreported_records: number;
  invalid_records: number;
  total_planned_runtime: number;
  total_actual_runtime: number;
  total_ideal_runtime: number;
  total_output: number;
  total_defect_qty: number;
  total_good_qty: number;
  reported_output: number;
  reported_defect_qty: number;
  active_machines: number;
}

interface ProductivityTotals {
  records_count: number;
  reported_records: number;
  unreported_records: number;
  invalid_records: number;
  total_planned_runtime: number | null;
  total_actual_runtime: number | null;
  total_ideal_runtime: number | null;
  total_output_qty: number | null;
  total_defect_qty: number | null;
  reported_output_qty: number | null;
  reported_defect_qty: number | null;
  unique_machines: number;
  shifts_analyzed: number;
}

interface ProductivityAggregate {
  reporting_coverage: {
    total_records: number;
    reported_records: number;
    unreported_records: number;
    invalid_records: number;
  };
  totals: ProductivityTotals;
  machines: ProductivityMachineRow[];
  shifts: ProductivityShiftRow[];
  daily: ProductivityDailyRow[];
}

const roundNullable = (value: number | null, digits: number): number | null => {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const compareNullableDesc = (left: number | null, right: number | null): number => {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return right - left;
};

// GET /api/productivity-analysis - 생산성 분석 데이터 조회
export async function GET(request: NextRequest) {
  try {
    await requireUser(request, ['admin', 'engineer']);

    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const analysisType = searchParams.get('analysis_type') || 'summary'; // summary, detail, trends
    const shift = searchParams.get('shift'); // 'A', 'B', 'C', 'D'

    console.info('📈 생산성 분석 API 요청:', { machineId, startDate, endDate, analysisType, shift });

    // 날짜 범위 설정 (기본값: 최근 30일)
    const fromDate = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = endDate ? new Date(endDate) : new Date();

    const fromDateStr = fromDate.toISOString().split('T')[0];
    const toDateStr = toDate.toISOString().split('T')[0];

    // 설비 필터링 (단일 ID 또는 콤마로 구분된 다중 ID 지원)
    const machineIds = machineId
      ? machineId.split(',').map(id => id.trim()).filter(Boolean)
      : [];
    // 교대 필터링 (단일 값 또는 콤마로 구분된 다중 값 지원)
    const shifts = shift
      ? shift.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const { data, error: recordsError } = await supabaseAdmin.rpc('analytics_productivity', {
      p_start_date: fromDateStr,
      p_end_date: toDateStr,
      p_machine_ids: machineIds.length > 0 ? machineIds : null,
      p_shifts: shifts.length > 0 ? shifts : null,
    });

    if (recordsError) {
      console.error('생산 기록 조회 오류:', recordsError);
      return NextResponse.json(
        { error: 'Failed to fetch production records' },
        { status: 500 }
      );
    }

    const aggregate = data as ProductivityAggregate;
    const totals = aggregate.totals;

    // 전체 생산성 요약 계산
    const totalRecords = totals.records_count || 0;
    const totalPlannedRuntime = totals.total_planned_runtime || 0;
    const totalActualRuntime = totals.total_actual_runtime || 0;
    const totalIdealRuntime = totals.total_ideal_runtime || 0;
    const totalOutputQty = totals.total_output_qty || 0;
    const totalDefectQty = totals.total_defect_qty || 0;
    const reportedOutputQty = totals.reported_output_qty || 0;
    const reportedDefectQty = totals.reported_defect_qty || 0;
    const totalGoodQty = totalOutputQty - totalDefectQty;
    const fallbackReportedRecords = totals.reported_records || 0;
    const fallbackInvalidRecords = totals.invalid_records || 0;
    const coverage = aggregate.reporting_coverage || {
      total_records: totalRecords,
      reported_records: fallbackReportedRecords,
      unreported_records: Math.max(
        0,
        totalRecords - fallbackReportedRecords - fallbackInvalidRecords
      ),
      invalid_records: fallbackInvalidRecords,
    };
    const excludedRecords = coverage.unreported_records + coverage.invalid_records;

    const overallMetrics = calculateWeightedOEE({
      reportedRecords: coverage.reported_records,
      totalPlannedRuntime,
      totalActualRuntime,
      totalIdealRuntime,
      totalOutput: reportedOutputQty,
      totalDefects: reportedDefectQty,
    });

    // 설비별 생산성 분석 (RPC 가 최초 등장 순으로 돌려주므로 기존 삽입 순서와 동일하다)
    const machineAnalysis = aggregate.machines.map(machine => {
      const metrics = calculateWeightedOEE({
        reportedRecords: machine.reported_records,
        totalPlannedRuntime: machine.total_planned_runtime,
        totalActualRuntime: machine.total_actual_runtime,
        totalIdealRuntime: machine.total_ideal_runtime,
        totalOutput: machine.reported_output,
        totalDefects: machine.reported_defect_qty,
      });

      return {
        machine_id: machine.machine_id,
        machine_name: machine.machine_name,
        equipment_type: machine.equipment_type,
        records_count: machine.records_count,
        reporting_coverage: {
          total_records: machine.records_count,
          reported_records: machine.reported_records,
          unreported_records: machine.unreported_records,
          invalid_records: machine.invalid_records,
          excluded_records: machine.unreported_records + machine.invalid_records,
        },
        oee_available: metrics.oee !== null,
        avg_oee: metrics.oee,
        avg_availability: metrics.availability,
        avg_performance: metrics.performance,
        avg_quality: metrics.quality,
        total_output: machine.total_output,
        total_good_qty: machine.total_good_qty,
        total_defect_qty: machine.total_defect_qty,
        total_planned_runtime: machine.total_planned_runtime,
        total_actual_runtime: machine.total_actual_runtime,
        total_ideal_runtime: machine.total_ideal_runtime,
        defect_rate: machine.total_output > 0 ? (machine.total_defect_qty / machine.total_output) * 100 : 0,
        utilization_rate: metrics.availability,
        efficiency_score: metrics.oee !== null && metrics.performance !== null && metrics.quality !== null
          ? (metrics.oee * 0.4) + (metrics.performance * 0.3) + (metrics.quality * 0.3)
          : null,
        best_shift: machine.best_shift || '',
        worst_shift: machine.worst_shift || '',
      };
    }).sort((a, b) => compareNullableDesc(a.avg_oee, b.avg_oee));

    // 교대별 생산성 분석
    const shiftSummary = aggregate.shifts.map(shiftRow => {
      const metrics = calculateWeightedOEE({
        reportedRecords: shiftRow.reported_records,
        totalPlannedRuntime: shiftRow.total_planned_runtime,
        totalActualRuntime: shiftRow.total_actual_runtime,
        totalIdealRuntime: shiftRow.total_ideal_runtime,
        totalOutput: shiftRow.reported_output,
        totalDefects: shiftRow.reported_defect_qty,
      });
      return {
        shift: shiftRow.shift,
        records_count: shiftRow.records_count,
        reporting_coverage: {
          total_records: shiftRow.records_count,
          reported_records: shiftRow.reported_records,
          unreported_records: shiftRow.unreported_records,
          invalid_records: shiftRow.invalid_records,
          excluded_records: shiftRow.unreported_records + shiftRow.invalid_records,
        },
        oee_available: metrics.oee !== null,
        avg_oee: metrics.oee,
        avg_availability: metrics.availability,
        avg_performance: metrics.performance,
        avg_quality: metrics.quality,
        total_output: shiftRow.total_output,
        total_good_qty: shiftRow.total_good_qty,
        defect_rate: shiftRow.total_output > 0
          ? (shiftRow.total_defect_qty / shiftRow.total_output) * 100
          : 0,
        machines_count: shiftRow.machines_count,
      };
    }).sort((a, b) => compareNullableDesc(a.avg_oee, b.avg_oee));

    // 일별 생산성 트렌드
    const sortedDailyTrends = aggregate.daily.map(day => {
      const metrics = calculateWeightedOEE({
        reportedRecords: day.reported_records,
        totalPlannedRuntime: day.total_planned_runtime,
        totalActualRuntime: day.total_actual_runtime,
        totalIdealRuntime: day.total_ideal_runtime,
        totalOutput: day.reported_output,
        totalDefects: day.reported_defect_qty,
      });
      return {
        date: day.date,
        oee_available: metrics.oee !== null,
        avg_oee: metrics.oee,
        avg_availability: metrics.availability,
        avg_performance: metrics.performance,
        avg_quality: metrics.quality,
        total_output: day.total_output,
        total_good_qty: day.total_good_qty,
        defect_rate: day.total_output > 0
          ? (day.total_defect_qty / day.total_output) * 100
          : 0,
        records_count: day.records_count,
        reporting_coverage: {
          total_records: day.records_count,
          reported_records: day.reported_records,
          unreported_records: day.unreported_records,
          invalid_records: day.invalid_records,
          excluded_records: day.unreported_records + day.invalid_records,
        },
        active_machines: day.active_machines,
      };
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Top/Bottom 성과 분석 (설비 수가 적을 때 상위/하위 목록이 겹치지 않도록 구성)
    const rankableMachines = machineAnalysis.filter(machine => machine.avg_oee !== null);
    const topCount = Math.min(5, rankableMachines.length);
    const bottomCount = Math.min(5, rankableMachines.length - topCount);
    const topPerformers = rankableMachines.slice(0, topCount);
    const bottomPerformers = rankableMachines.slice(rankableMachines.length - bottomCount).reverse();

    // 상세 레코드는 요청이 있을 때만 원본 행을 조회한다 (집계 경로에서는 원본을 가져오지 않는다).
    //
    // 원본 행이므로 페이지네이션이 필수다. 넓은 기간을 요청하면 매칭 행이
    // PostgREST max-rows(=100,000)를 넘어 응답이 조용히 잘린다.
    // count: 'exact' 로 전체 매칭 건수를 함께 받아 절삭 여부를 응답에 노출한다.
    // (여기서는 건수만 필요하므로 별도 집계 RPC 없이 count 로 충분하다.
    //  평균까지 필요한 /api/oee-data 는 analytics_oee_records_summary RPC 를 쓴다.)
    let detailedRecords: Array<Record<string, unknown>> | undefined;
    let detailedRecordsPagination: PaginationMeta | undefined;
    if (analysisType === 'detail') {
      const detailLimit = parseIntParam(
        searchParams.get('limit'),
        DEFAULT_PAGE_LIMIT,
        1,
        MAX_PAGE_LIMIT
      );
      const detailOffset = parseIntParam(
        searchParams.get('offset'),
        0,
        0,
        Number.MAX_SAFE_INTEGER
      );

      let detailQuery = supabaseAdmin
        .from('production_records')
        .select(`
          record_id,
          machine_id,
          date,
          shift,
          availability,
          performance,
          quality,
          oee,
          output_qty,
          defect_qty,
          machines!inner(name)
        `, { count: 'exact' })
        .gte('date', fromDateStr)
        .lte('date', toDateStr)
        .order('date', { ascending: false })
        // date 만으로는 정렬이 불안정해 페이지 간 행이 중복/누락될 수 있다.
        .order('record_id', { ascending: false })
        .range(detailOffset, detailOffset + detailLimit - 1);

      if (machineIds.length > 1) {
        detailQuery = detailQuery.in('machine_id', machineIds);
      } else if (machineIds.length === 1) {
        detailQuery = detailQuery.eq('machine_id', machineIds[0]);
      }

      if (shifts.length > 1) {
        detailQuery = detailQuery.in('shift', shifts);
      } else if (shifts.length === 1) {
        detailQuery = detailQuery.eq('shift', shifts[0]);
      }

      const { data: detailRows, error: detailError, count: detailCount } = await detailQuery;

      if (detailError) {
        console.error('생산 기록 상세 조회 오류:', detailError);
        return NextResponse.json(
          { error: 'Failed to fetch production records' },
          { status: 500 }
        );
      }

      detailedRecordsPagination = buildPaginationMeta(
        detailLimit,
        detailOffset,
        (detailRows || []).length,
        detailCount ?? 0
      );

      detailedRecords = (detailRows || []).map(record => ({
        record_id: record.record_id,
        machine_id: record.machine_id,
        machine_name: unwrapJoin(record.machines)?.name || 'Unknown',
        date: record.date,
        shift: record.shift,
        oee: record.oee,
        availability: record.availability,
        performance: record.performance,
        quality: record.quality,
        output_qty: record.output_qty,
        good_qty: (record.output_qty || 0) - (record.defect_qty || 0),
        defect_qty: record.defect_qty,
        defect_rate: record.output_qty > 0 ? Math.round(((record.defect_qty / record.output_qty) * 100) * 100) / 100 : 0
      }));
    }

    // 응답 구성
    const response = {
      summary: {
        reporting_coverage: {
          ...coverage,
          excluded_records: excludedRecords,
          reporting_rate: coverage.total_records > 0
            ? coverage.reported_records / coverage.total_records
            : 1,
          incomplete: excludedRecords > 0,
        },
        analysis_period: {
          start_date: fromDateStr,
          end_date: toDateStr,
          days: Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)),
          total_records: totalRecords
        },
        overall_performance: {
          avg_oee: roundNullable(overallMetrics.oee, 4),
          avg_availability: roundNullable(overallMetrics.availability, 4),
          avg_performance: roundNullable(overallMetrics.performance, 4),
          avg_quality: roundNullable(overallMetrics.quality, 4),
          total_output_qty: totalOutputQty,
          total_good_qty: totalGoodQty,
          total_defect_qty: totalDefectQty,
          overall_defect_rate: totalOutputQty > 0 ? Math.round(((totalDefectQty / totalOutputQty) * 100) * 100) / 100 : 0,
          utilization_rate: overallMetrics.availability === null
            ? null
            : Math.round(overallMetrics.availability * 10_000) / 100
        },
        unique_machines: totals.unique_machines,
        shifts_analyzed: totals.shifts_analyzed
      },
      machine_analysis: machineAnalysis,
      shift_analysis: shiftSummary,
      performance_ranking: {
        top_performers: topPerformers.map(m => ({
          machine_id: m.machine_id,
          machine_name: m.machine_name,
          avg_oee: roundNullable(m.avg_oee, 2),
          efficiency_score: roundNullable(m.efficiency_score, 2),
        })),
        bottom_performers: bottomPerformers.map(m => ({
          machine_id: m.machine_id,
          machine_name: m.machine_name,
          avg_oee: roundNullable(m.avg_oee, 2),
          efficiency_score: roundNullable(m.efficiency_score, 2),
        }))
      },
      trends: {
        daily: sortedDailyTrends.map(trend => ({
          ...trend,
          avg_oee: roundNullable(trend.avg_oee, 2),
          avg_availability: roundNullable(trend.avg_availability, 2),
          avg_performance: roundNullable(trend.avg_performance, 2),
          avg_quality: roundNullable(trend.avg_quality, 2),
          defect_rate: Math.round(trend.defect_rate * 100) / 100
        }))
      },
      detailed_records: detailedRecords,
      // analysis_type=detail 일 때만 존재한다. detailed_records 가 전체인지
      // 잘린 페이지인지 호출자가 알 수 있게 total/has_more 를 함께 싣는다.
      detailed_records_pagination: detailedRecordsPagination,
      metadata: {
        aggregation_method: 'runtime_output_weighted',
        query_time: new Date().toISOString(),
        filters: {
          machine_id: machineId,
          start_date: startDate,
          end_date: endDate,
          shift: shift,
          analysis_type: analysisType
        }
      }
    };

    console.info('✅ 생산성 분석 완료:', {
      평균OEE: overallMetrics.oee,
      총생산량: totalOutputQty,
      설비수: response.summary.unique_machines,
      교대수: response.summary.shifts_analyzed
    });

    console.info('📊 일별 트렌드 데이터 확인:', {
      dailyTrendsCount: sortedDailyTrends.length,
      sampleTrends: sortedDailyTrends.slice(0, 3),
      totalRecords: totalRecords
    });

    return NextResponse.json(response);

  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('❌ 생산성 분석 API 오류:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
