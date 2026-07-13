import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { unwrapJoin } from '@/types';

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
  sum_performance: number;
  sum_quality: number;
  total_output: number;
  total_defect_qty: number;
  total_good_qty: number;
  total_planned_runtime: number;
  total_actual_runtime: number;
  best_shift: string | null;
  worst_shift: string | null;
  first_rn: number;
}

interface ProductivityShiftRow {
  shift: string;
  records_count: number;
  sum_oee: number;
  sum_availability: number;
  sum_performance: number;
  sum_quality: number;
  total_output: number;
  total_good_qty: number;
  machines_count: number;
  first_rn: number;
}

interface ProductivityDailyRow {
  date: string;
  records_count: number;
  sum_oee: number;
  sum_availability: number;
  sum_performance: number;
  sum_quality: number;
  total_output: number;
  total_good_qty: number;
  active_machines: number;
}

interface ProductivityTotals {
  records_count: number;
  sum_availability: number | null;
  sum_performance: number | null;
  sum_quality: number | null;
  sum_oee: number | null;
  total_planned_runtime: number | null;
  total_actual_runtime: number | null;
  total_output_qty: number | null;
  total_defect_qty: number | null;
  unique_machines: number;
  shifts_analyzed: number;
}

interface ProductivityAggregate {
  totals: ProductivityTotals;
  machines: ProductivityMachineRow[];
  shifts: ProductivityShiftRow[];
  daily: ProductivityDailyRow[];
}

// GET /api/productivity-analysis - 생산성 분석 데이터 조회
export async function GET(request: NextRequest) {
  try {
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
    const totalOutputQty = totals.total_output_qty || 0;
    const totalDefectQty = totals.total_defect_qty || 0;
    const totalGoodQty = totalOutputQty - totalDefectQty;

    const avgAvailability = (totals.sum_availability || 0) / totalRecords || 0;
    const avgPerformance = (totals.sum_performance || 0) / totalRecords || 0;
    const avgQuality = (totals.sum_quality || 0) / totalRecords || 0;
    const avgOEE = (totals.sum_oee || 0) / totalRecords || 0;

    // 설비별 생산성 분석 (RPC 가 최초 등장 순으로 돌려주므로 기존 삽입 순서와 동일하다)
    const machineAnalysis = aggregate.machines.map(machine => {
      // 가동률은 레코드 단순 평균이 아닌 총 실제가동시간/총 계획가동시간 비율로 계산 (Simpson's paradox 방지)
      const avg_availability = machine.total_planned_runtime > 0
        ? machine.total_actual_runtime / machine.total_planned_runtime
        : 0;
      const avg_performance = machine.sum_performance / machine.records_count;
      const avg_quality = machine.sum_quality / machine.records_count;
      // OEE = 가동률 × 성능 × 품질 정의에 따라 재계산 (oee 컬럼의 단순 평균은 레코드 수에 따라 왜곡됨)
      const avg_oee = avg_availability * avg_performance * avg_quality;

      return {
        machine_id: machine.machine_id,
        machine_name: machine.machine_name,
        equipment_type: machine.equipment_type,
        records_count: machine.records_count,
        avg_oee,
        avg_availability,
        avg_performance,
        avg_quality,
        total_output: machine.total_output,
        total_good_qty: machine.total_good_qty,
        total_defect_qty: machine.total_defect_qty,
        total_planned_runtime: machine.total_planned_runtime,
        total_actual_runtime: machine.total_actual_runtime,
        defect_rate: machine.total_output > 0 ? (machine.total_defect_qty / machine.total_output) * 100 : 0,
        utilization_rate: avg_availability,
        efficiency_score: (avg_oee * 0.4) + (avg_performance * 0.3) + (avg_quality * 0.3),
        best_shift: machine.best_shift || '',
        worst_shift: machine.worst_shift || '',
      };
    }).sort((a, b) => b.avg_oee - a.avg_oee);

    // 교대별 생산성 분석
    const shiftSummary = aggregate.shifts.map(shiftRow => ({
      shift: shiftRow.shift,
      records_count: shiftRow.records_count,
      avg_oee: shiftRow.sum_oee / shiftRow.records_count,
      avg_availability: shiftRow.sum_availability / shiftRow.records_count,
      avg_performance: shiftRow.sum_performance / shiftRow.records_count,
      avg_quality: shiftRow.sum_quality / shiftRow.records_count,
      total_output: shiftRow.total_output,
      total_good_qty: shiftRow.total_good_qty,
      defect_rate: shiftRow.total_output > 0
        ? ((shiftRow.total_output - shiftRow.total_good_qty) / shiftRow.total_output) * 100
        : 0,
      machines_count: shiftRow.machines_count,
    })).sort((a, b) => b.avg_oee - a.avg_oee);

    // 일별 생산성 트렌드
    const sortedDailyTrends = aggregate.daily.map(day => ({
      date: day.date,
      avg_oee: day.sum_oee / day.records_count,
      avg_availability: day.sum_availability / day.records_count,
      avg_performance: day.sum_performance / day.records_count,
      avg_quality: day.sum_quality / day.records_count,
      total_output: day.total_output,
      total_good_qty: day.total_good_qty,
      defect_rate: day.total_output > 0
        ? ((day.total_output - day.total_good_qty) / day.total_output) * 100
        : 0,
      records_count: day.records_count,
      active_machines: day.active_machines,
    })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Top/Bottom 성과 분석 (설비 수가 적을 때 상위/하위 목록이 겹치지 않도록 구성)
    const topCount = Math.min(5, machineAnalysis.length);
    const bottomCount = Math.min(5, machineAnalysis.length - topCount);
    const topPerformers = machineAnalysis.slice(0, topCount);
    const bottomPerformers = machineAnalysis.slice(machineAnalysis.length - bottomCount).reverse();

    // 상세 레코드는 요청이 있을 때만 원본 행을 조회한다 (집계 경로에서는 원본을 가져오지 않는다)
    let detailedRecords: Array<Record<string, unknown>> | undefined;
    if (analysisType === 'detail') {
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
        `)
        .gte('date', fromDateStr)
        .lte('date', toDateStr)
        .order('date', { ascending: false });

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

      const { data: detailRows, error: detailError } = await detailQuery;

      if (detailError) {
        console.error('생산 기록 상세 조회 오류:', detailError);
        return NextResponse.json(
          { error: 'Failed to fetch production records' },
          { status: 500 }
        );
      }

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
        analysis_period: {
          start_date: fromDateStr,
          end_date: toDateStr,
          days: Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)),
          total_records: totalRecords
        },
        overall_performance: {
          avg_oee: Math.round(avgOEE * 100) / 100,
          avg_availability: Math.round(avgAvailability * 100) / 100,
          avg_performance: Math.round(avgPerformance * 100) / 100,
          avg_quality: Math.round(avgQuality * 100) / 100,
          total_output_qty: totalOutputQty,
          total_good_qty: totalGoodQty,
          total_defect_qty: totalDefectQty,
          overall_defect_rate: totalOutputQty > 0 ? Math.round(((totalDefectQty / totalOutputQty) * 100) * 100) / 100 : 0,
          utilization_rate: totalPlannedRuntime > 0 ? Math.round(((totalActualRuntime / totalPlannedRuntime) * 100) * 100) / 100 : 0
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
          avg_oee: Math.round(m.avg_oee * 100) / 100,
          efficiency_score: Math.round(m.efficiency_score * 100) / 100,
        })),
        bottom_performers: bottomPerformers.map(m => ({
          machine_id: m.machine_id,
          machine_name: m.machine_name,
          avg_oee: Math.round(m.avg_oee * 100) / 100,
          efficiency_score: Math.round(m.efficiency_score * 100) / 100,
        }))
      },
      trends: {
        daily: sortedDailyTrends.map(trend => ({
          ...trend,
          avg_oee: Math.round(trend.avg_oee * 100) / 100,
          avg_availability: Math.round(trend.avg_availability * 100) / 100,
          avg_performance: Math.round(trend.avg_performance * 100) / 100,
          avg_quality: Math.round(trend.avg_quality * 100) / 100,
          defect_rate: Math.round(trend.defect_rate * 100) / 100
        }))
      },
      detailed_records: detailedRecords,
      metadata: {
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
      평균OEE: avgOEE,
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
    console.error('❌ 생산성 분석 API 오류:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
