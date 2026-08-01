import { NextRequest, NextResponse } from 'next/server';
import { format } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';
import { chunkIdsForInFilter } from '@/lib/idFilter';
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
  avg_availability: number | null;
  avg_performance: number | null;
  avg_quality: number | null;
  avg_oee: number | null;
  total_output: number;
  total_defect: number;
  total_good: number;
  total_planned_runtime: number;
  total_actual_runtime: number;
  total_ideal_runtime: number;
  /**
   * 비가동 신뢰도 지표.
   *
   * 비가동은 작업자가 직접 입력한다. downtime_minutes IS NULL 인 기록은 OEE에서 제외하고
   * 생산량 합계에는 유지한다. 평균만 내려주면 계산 커버리지가 보이지 않으므로 미확인 규모와
   * 확인된 기록 수를 함께 내려보내 호출부가 신뢰도를 표시할 수 있게 한다.
   */
  unreported_records: number;
  reported_records: number;
  avg_availability_reported: number | null;
  avg_oee_reported: number | null;
  impossible_records: number;
  avg_oee_excluding_impossible: number | null;
  avg_quality_excluding_impossible: number | null;
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
const round3 = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 1000) / 1000 : null;
};
const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

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
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const shift = searchParams.get('shift');
    const aggregation = searchParams.get('aggregation') || 'daily'; // 기본 조회 창 선택에만 사용
    const includeStatistics = searchParams.get('include_statistics') !== 'false';
    const knownTotal = parseIntParam(
      searchParams.get('known_total'),
      0,
      0,
      Number.MAX_SAFE_INTEGER
    );

    const limit = parseIntParam(searchParams.get('limit'), DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT);
    const offset = parseIntParam(searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);

    const validationError = validateFilters(machineId, startDate, endDate);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    /**
     * 운영자 스코프.
     *
     * 예전에는 `assertMachineAccess(user, machineId || '')` 로 **machine_id 를 필수**로
     * 만들었다. 그래서 운영자 화면은 담당 설비마다 이 API 를 한 번씩 불러야 했고,
     * 이 프로젝트의 운영자는 전원 800대를 배정받으므로 **800번의 순차 요청**이 됐다.
     * 요청당 200ms 만 잡아도 160초 — 운영자 대시보드가 사실상 뜨지 않았다.
     *
     * 다른 라우트(`/api/machines`, `/api/production-records`)는 이미 서버에서 스코프를
     * 건다. 여기만 클라이언트에 떠넘긴 탓에 같은 문제를 두 방식으로 풀고 있었다.
     * 이제 여기서도 서버가 건다 — 담당 설비 목록을 `.in()` 으로, URL 한계를 넘지 않게
     * 잘라서(`@/lib/idFilter`).
     */
    const scopeChunks: Array<string[] | null> = (() => {
      if (user.role !== 'operator') return [null];
      if (machineId) {
        assertMachineAccess(user, machineId);
        return [null];
      }
      return chunkIdsForInFilter(user.assignedMachineIds);
    })();

    // 담당 설비 목록으로 좁히는 경로인가. 이때만 청크 병합과 count 합산이 필요하다.
    const isChunkedScope = scopeChunks[0] !== null;

    // 통계(평균 묶음)는 `analytics_oee_records_summary` 가 SQL 에서 계산하는데, 그 RPC 는
    // 설비를 **하나**만 받는다(p_machine_id). 담당 설비 목록으로는 표현할 수 없다.
    //
    // 청크별로 계산해 합치는 것은 틀린다 — 평균의 평균은 평균이 아니다. 조용히 틀린
    // 숫자를 내느니 이 조합을 거절한다. RPC 에 설비 목록 인자를 추가하려면 마이그레이션이
    // 필요하다. `total` 은 아래에서 청크별 count 합으로 정확히 구하므로(청크는 서로소)
    // 페이지네이션은 통계 없이도 정상 동작한다.
    if (includeStatistics && isChunkedScope) {
      return NextResponse.json(
        { error: 'include_statistics requires machine_id for operators' },
        { status: 400 }
      );
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
    const summaryResult = includeStatistics
      ? await supabaseAdmin.rpc('analytics_oee_records_summary', {
          p_start_date: effectiveStartDate,
          p_end_date: effectiveEndDate,
          p_machine_id: machineId,
          p_shift: shift,
        })
      : { data: null, error: null };

    if (summaryResult.error) {
      console.error('Database error (oee summary):', summaryResult.error);
      return NextResponse.json(
        { error: 'Failed to fetch OEE statistics' },
        { status: 500 }
      );
    }

    const summaryRows = summaryResult.data;

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
    const summaryTotal = includeStatistics
      ? Number(summary.total_records) || 0
      : knownTotal;

    // 원시 행은 요청한 페이지만 가져온다.
    // 운영자 스코프가 여러 청크로 나뉘면 청크마다 앞에서 (offset+limit) 개까지 받아
    // 병합·정렬한 뒤 잘라낸다 — 청크는 machine_id 로 서로소이고 정렬이 전순서라
    // 결과가 한 번에 조회한 것과 같다. (같은 근거는 production-records 라우트 참고)
    const buildRowQuery = (scope: string[] | null) => {
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
        downtime_minutes,
        created_at,
        machines!inner(name)
      `, isChunkedScope ? { count: 'exact' } : undefined)
        .gte('date', effectiveStartDate)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        // record_id 로 마지막 정렬 기준을 고정한다. (date, created_at) 이 같은 행이
        // 여러 개 있으면 순서가 불안정해져 페이지 간 행이 중복/누락될 수 있다.
        .order('record_id', { ascending: false })
        // 청크가 하나면 예전과 같이 그 페이지만 받는다.
        .range(scope ? 0 : offset, offset + limit - 1);

      if (effectiveEndDate) query = query.lte('date', effectiveEndDate);
      if (machineId) query = query.eq('machine_id', machineId);
      if (shift) query = query.eq('shift', shift);
      if (scope) query = query.in('machine_id', scope);
      return query;
    };

    const rowPages = await Promise.all(scopeChunks.map(scope => buildRowQuery(scope)));
    const rowError = rowPages.find(p => p.error)?.error;

    if (rowError) {
      console.error('Database error:', rowError);
      return NextResponse.json(
        { error: 'Failed to fetch production data' },
        { status: 500 }
      );
    }

    const mergedRows = rowPages.flatMap(p => p.data ?? []);
    // 비교 함수는 위 ORDER BY 와 **같은 말**이어야 한다. 달라지면 페이지 경계에서
    // 행이 사라지거나 중복된다.
    if (scopeChunks.length > 1) {
      mergedRows.sort((a, b) =>
        a.date !== b.date ? String(b.date).localeCompare(String(a.date))
        : a.created_at !== b.created_at ? String(b.created_at).localeCompare(String(a.created_at))
        : String(b.record_id).localeCompare(String(a.record_id))
      );
    }
    const productionData = isChunkedScope
      ? mergedRows.slice(offset, offset + limit)
      : mergedRows;

    // 담당 설비 스코프에서는 청크별 count 를 합해 전체 건수를 구한다. 청크는 machine_id 로
    // 서로소이므로 합이 곧 정확한 총계다. `has_more` 가 이 값에 의존하므로 여기를 비우면
    // 호출자는 첫 페이지만 받고 **조용히 멈춘다** — 통계를 막았다고 총계까지 비우면 안 된다.
    const totalRecords = isChunkedScope
      ? rowPages.reduce((sum, p) => sum + (p.count ?? 0), 0)
      : summaryTotal;

    const oeeData = (productionData || []).map(record => ({
      id: record.record_id,
      record_id: record.record_id,
      machine_id: record.machine_id,
      machine_name: unwrapJoin(record.machines)?.name || 'Unknown',
      date: record.date,
      shift: record.shift,
      availability: toNullableNumber(record.availability),
      performance: toNullableNumber(record.performance),
      quality: toNullableNumber(record.quality),
      oee: toNullableNumber(record.oee),
      actual_runtime: toNullableNumber(record.actual_runtime),
      planned_runtime: toNullableNumber(record.planned_runtime),
      ideal_runtime: toNullableNumber(record.ideal_runtime),
      output_qty: record.output_qty || 0,
      defect_qty: record.defect_qty || 0,
      downtime_minutes: record.downtime_minutes,
      created_at: record.created_at,
      updated_at: record.created_at
    }));

    return NextResponse.json({
      oee_data: oeeData,
      statistics: includeStatistics ? {
        // 전체 집합 기준. oee_data 에 담긴 페이지가 아니라 필터에 해당하는 모든 행의 평균이다.
        total_records: totalRecords,
        avg_oee: round3(summary.avg_oee),
        avg_availability: round3(summary.avg_availability),
        avg_performance: round3(summary.avg_performance),
        avg_quality: round3(summary.avg_quality),
        total_output: Number(summary.total_output) || 0,
        total_defect: Number(summary.total_defect) || 0,
        total_good: Number(summary.total_good) || 0,
        total_planned_runtime: Number(summary.total_planned_runtime) || 0,
        total_actual_runtime: Number(summary.total_actual_runtime) || 0,
        total_ideal_runtime: Number(summary.total_ideal_runtime) || 0,
        aggregation_method: 'runtime_output_weighted',
        data_quality: {
          impossible_records: Number(summary.impossible_records) || 0,
          avg_oee_excluding_impossible: round3(summary.avg_oee_excluding_impossible),
          avg_quality_excluding_impossible: round3(summary.avg_quality_excluding_impossible),
        },

        // 위 OEE가 전체 생산기록 중 몇 건을 근거로 계산됐는지 나타내는 지표.
        // 비가동 미확인 기록은 생산량 합계에는 포함되지만 OEE 계산에서는 제외된다.
        downtime_reporting: {
          unreported_records: Number(summary.unreported_records) || 0,
          reported_records: Number(summary.reported_records) || 0,
          unreported_ratio:
            totalRecords > 0
              ? Math.round(((Number(summary.unreported_records) || 0) / totalRecords) * 1000) / 1000
              : 0,
          avg_availability_reported: round3(summary.avg_availability_reported),
          avg_oee_reported: round3(summary.avg_oee_reported),
        },
      } : null,
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
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error fetching OEE data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch OEE data' },
      { status: 500 }
    );
  }
}
