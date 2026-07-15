import { NextRequest, NextResponse } from 'next/server';
import { format } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  buildPaginationMeta,
  parseIntParam,
} from '@/lib/pagination';
import { unwrapJoin } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * 이 라우트는 production_records 원시 행을 그대로 돌려주는 계약이라
 * 필터 결과가 수십만 행이 될 수 있다(연간 조회 시 약 325,000행).
 * 이전에는 .limit() 없이 조회해 PostgREST 의 max-rows(=100,000) 에 조용히 걸렸고,
 * statistics 가 그 잘린 조각 위에서 계산되면서 전체 평균인 것처럼 반환됐다.
 * 페이지네이션 규칙과 그 배경은 @/lib/pagination 참고.
 */

/** analytics_oee_records_summary RPC 가 돌려주는 전체 집합 기준 통계 */
interface OeeRecordsSummary {
  total_records: number;
  avg_availability: number;
  avg_performance: number;
  avg_quality: number;
  avg_oee: number;
  total_output: number;
  total_defect: number;
  total_good: number;
  total_planned_runtime: number;
  total_actual_runtime: number;
  total_ideal_runtime: number;
  /**
   * 비가동 신뢰도 지표.
   *
   * 비가동은 작업자가 직접 입력한다. 입력하지 않으면 actual_runtime = planned_runtime 이 되어
   * 가동률이 100% 로 집계되고 OEE 가 부풀려진다. downtime_minutes IS NULL 인 기록이 그 경우다.
   * 평균값만 내려주면 이 왜곡이 보이지 않으므로, 미확인 규모와
   * "비가동이 확인된 기록만의 지표"를 함께 내려보내 호출부가 신뢰도를 표시할 수 있게 한다.
   */
  unreported_records: number;
  reported_records: number;
  avg_availability_reported: number;
  avg_oee_reported: number;
  impossible_records: number;
  avg_oee_excluding_impossible: number;
  avg_quality_excluding_impossible: number;
}

/** 기본 조회 창(일). start_date/end_date 가 없을 때만 사용한다. */
function defaultWindowDays(aggregation: string): number {
  switch (aggregation) {
    case 'monthly':
      return 30;
    case 'yearly':
      return 365;
    case 'weekly':
    case 'daily':
    default:
      return 7;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 잘못된 machine_id/날짜는 DB 까지 내려가면 타입 캐스팅 오류로 500 이 된다.
 * 클라이언트 입력 오류이므로 여기서 걸러 400 으로 돌려준다.
 */
function validateFilters(
  machineId: string | null,
  startDate: string | null,
  endDate: string | null
): string | null {
  if (machineId && !UUID_PATTERN.test(machineId)) {
    return 'machine_id must be a UUID';
  }
  if (startDate && !DATE_PATTERN.test(startDate)) {
    return 'start_date must be in YYYY-MM-DD format';
  }
  if (endDate && !DATE_PATTERN.test(endDate)) {
    return 'end_date must be in YYYY-MM-DD format';
  }
  if (startDate && endDate && startDate > endDate) {
    return 'start_date must not be after end_date';
  }
  return null;
}

// GET /api/oee-data - OEE 원시 행 조회 (페이지네이션) + 전체 집합 기준 통계
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const shift = searchParams.get('shift');
    const aggregation = searchParams.get('aggregation') || 'daily'; // 기본 조회 창 선택에만 사용

    const limit = parseIntParam(searchParams.get('limit'), DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT);
    const offset = parseIntParam(searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);

    const validationError = validateFilters(machineId, startDate, endDate);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // 실제 적용되는 날짜 범위를 먼저 확정한다.
    // 통계(RPC)와 행 조회가 반드시 같은 범위를 보게 하기 위함이다.
    let effectiveStartDate: string;
    const effectiveEndDate: string | null = startDate && endDate ? endDate : null;

    if (startDate && endDate) {
      effectiveStartDate = startDate;
    } else {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - defaultWindowDays(aggregation));
      // toISOString() 은 UTC 로 변환되어 KST 새벽(B교대 근무 중)에 날짜가 하루 밀린다.
      // 코드베이스 전반과 동일하게 로컬 달력 날짜를 사용한다.
      effectiveStartDate = format(fromDate, 'yyyy-MM-dd');
    }

    // 통계는 전체 집합 위에서 DB 가 계산한다.
    // 행을 전송하지 않으므로 max-rows 한도의 영향을 받지 않는다.
    const { data: summaryRows, error: summaryError } = await supabaseAdmin.rpc(
      'analytics_oee_records_summary',
      {
        p_start_date: effectiveStartDate,
        p_end_date: effectiveEndDate,
        p_machine_id: machineId,
        p_shift: shift,
      }
    );

    if (summaryError) {
      console.error('Database error (oee summary):', summaryError);
      return NextResponse.json(
        { error: 'Failed to fetch OEE statistics' },
        { status: 500 }
      );
    }

    const summary = (summaryRows as OeeRecordsSummary[] | null)?.[0] ?? {
      total_records: 0,
      avg_availability: 0,
      avg_performance: 0,
      avg_quality: 0,
      avg_oee: 0,
      total_output: 0,
      total_defect: 0,
      total_good: 0,
      total_planned_runtime: 0,
      total_actual_runtime: 0,
      total_ideal_runtime: 0,
      unreported_records: 0,
      reported_records: 0,
      avg_availability_reported: 0,
      avg_oee_reported: 0,
      impossible_records: 0,
      avg_oee_excluding_impossible: 0,
      avg_quality_excluding_impossible: 0,
    };
    const totalRecords = Number(summary.total_records) || 0;

    // 원시 행은 요청한 페이지만 가져온다.
    let query = supabaseAdmin
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
        planned_runtime,
        actual_runtime,
        ideal_runtime,
        output_qty,
        defect_qty,
        created_at,
        machines!inner(name)
      `)
      .gte('date', effectiveStartDate)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      // record_id 로 마지막 정렬 기준을 고정한다. (date, created_at) 이 같은 행이
      // 여러 개 있으면 순서가 불안정해져 페이지 간 행이 중복/누락될 수 있다.
      .order('record_id', { ascending: false })
      .range(offset, offset + limit - 1);

    if (effectiveEndDate) {
      query = query.lte('date', effectiveEndDate);
    }
    if (machineId) {
      query = query.eq('machine_id', machineId);
    }
    if (shift) {
      query = query.eq('shift', shift);
    }

    const { data: productionData, error } = await query;

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch production data' },
        { status: 500 }
      );
    }

    const oeeData = (productionData || []).map(record => ({
      id: record.record_id,
      machine_id: record.machine_id,
      machine_name: unwrapJoin(record.machines)?.name || 'Unknown',
      date: record.date,
      shift: record.shift,
      availability: Number(record.availability || 0),
      performance: Number(record.performance || 0),
      quality: Number(record.quality || 0),
      oee: Number(record.oee || 0),
      actual_runtime: record.actual_runtime || 0,
      planned_runtime: record.planned_runtime || 480,
      ideal_runtime: record.ideal_runtime || 0,
      output_qty: record.output_qty || 0,
      defect_qty: record.defect_qty || 0,
      created_at: record.created_at,
      updated_at: record.created_at
    }));

    return NextResponse.json({
      oee_data: oeeData,
      statistics: {
        // 전체 집합 기준. oee_data 에 담긴 페이지가 아니라 필터에 해당하는 모든 행의 평균이다.
        total_records: totalRecords,
        avg_oee: Math.round(summary.avg_oee * 1000) / 1000,
        avg_availability: Math.round(summary.avg_availability * 1000) / 1000,
        avg_performance: Math.round(summary.avg_performance * 1000) / 1000,
        avg_quality: Math.round(summary.avg_quality * 1000) / 1000,
        total_output: Number(summary.total_output) || 0,
        total_defect: Number(summary.total_defect) || 0,
        total_good: Number(summary.total_good) || 0,
        total_planned_runtime: Number(summary.total_planned_runtime) || 0,
        total_actual_runtime: Number(summary.total_actual_runtime) || 0,
        total_ideal_runtime: Number(summary.total_ideal_runtime) || 0,
        aggregation_method: 'runtime_output_weighted',
        data_quality: {
          impossible_records: Number(summary.impossible_records) || 0,
          avg_oee_excluding_impossible:
            Math.round(summary.avg_oee_excluding_impossible * 1000) / 1000,
          avg_quality_excluding_impossible:
            Math.round(summary.avg_quality_excluding_impossible * 1000) / 1000,
        },

        // 위 평균을 얼마나 믿을 수 있는지 나타내는 지표.
        // 비가동이 확인되지 않은 기록은 가동률이 100% 로 잡혀 OEE 를 끌어올린다.
        // 호출부는 unreported_records 비율이 높으면 평균을 그대로 신뢰하지 말고
        // *_reported 값(비가동이 확인된 기록만의 지표)을 함께 보여줘야 한다.
        downtime_reporting: {
          unreported_records: Number(summary.unreported_records) || 0,
          reported_records: Number(summary.reported_records) || 0,
          unreported_ratio:
            totalRecords > 0
              ? Math.round(((Number(summary.unreported_records) || 0) / totalRecords) * 1000) / 1000
              : 0,
          avg_availability_reported:
            Math.round(summary.avg_availability_reported * 1000) / 1000,
          avg_oee_reported: Math.round(summary.avg_oee_reported * 1000) / 1000,
        },
      },
      pagination: buildPaginationMeta(limit, offset, oeeData.length, totalRecords),
      filters: {
        machine_id: machineId,
        start_date: startDate,
        end_date: endDate,
        // 파라미터가 없을 때 실제로 적용된 범위. 호출자가 응답이 무엇을 담고 있는지 알 수 있게 한다.
        effective_start_date: effectiveStartDate,
        effective_end_date: effectiveEndDate,
        shift,
        aggregation
      }
    });
  } catch (error) {
    console.error('Error fetching OEE data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch OEE data' },
      { status: 500 }
    );
  }
}
