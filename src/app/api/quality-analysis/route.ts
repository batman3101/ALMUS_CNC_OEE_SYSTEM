import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';
import { unwrapJoin } from '@/types';
import { calculateWeightedQualityPercent, parseDetailPagination } from './qualityRules';

export const dynamic = 'force-dynamic';

// DB의 production_records.quality는 0-1 비율로 저장되지만, 이 API의 응답(품질 임계값,
// 품질 분포 구간, 클라이언트 차트)은 모두 0-100 퍼센트 기준이다.
// 따라서 DB 값을 읽는 즉시 퍼센트로 변환해 모든 계산/응답을 퍼센트 스케일로 통일한다.
// 집계 경로에서는 analytics_quality() RPC 가 동일한 변환(quality * 100)을 수행하며,
// 아래 헬퍼는 원본 행을 직접 다루는 detail 경로에서만 쓰인다.
const toQualityPercent = (quality: number | null | undefined): number => (quality || 0) * 100;

// 품질 트렌드 판정 임계값 (퍼센트 포인트). 품질이 99% 내외로 밀집되어 있어 1%p는 과도하게 크다.
const QUALITY_TREND_THRESHOLD_PP = 0.5;

/**
 * 집계는 analytics_quality() RPC(Postgres)에서 수행한다.
 *
 * 이전에는 production_records 원본 행을 전부 가져와(30일 전체 설비 기준 34,565행)
 * JS 루프로 집계했다. 이제 DB 가 설비별·교대별·일별 사전집계만 돌려준다.
 *
 * RPC 는 기존 라우트가 순회하던 행 순서(date DESC)를 row_number 로 보존해
 *  - 부동소수점 합계를 같은 순서로 누적하고,
 *  - 각 그룹의 first_rn(최초 등장 순번)을 함께 돌려준다.
 * 이 데이터셋에서는 800대 중 744대가 avg_quality = 100 으로 완전히 동률이라,
 * 안정 정렬의 동률 처리(= 삽입 순서)를 복원하지 못하면 machine_analysis 배열 순서와
 * quality_ranking(상위 5대)이 통째로 달라진다.
 *
 * 응답의 모든 품질 값은 0-100 퍼센트 스케일이다.
 */
interface QualityMachineRow {
  machine_id: string;
  machine_name: string;
  equipment_type: string;
  records_count: number;
  total_output: number;
  total_defects: number;
  total_good: number;
  compliant_count: number;
  quality_variance: number;
  best_quality_day: string;
  worst_quality_day: string;
  first_half_avg: number | null;
  second_half_avg: number | null;
  first_rn: number;
}

interface QualityShiftRow {
  shift: string;
  records_count: number;
  total_output: number;
  total_defects: number;
  sum_quality: number;
  compliant_count: number;
  machines_count: number;
  first_rn: number;
}

interface QualityDailyRow {
  date: string;
  records_count: number;
  total_output: number;
  total_defects: number;
  sum_quality: number;
  compliant_count: number;
  active_machines: number;
}

interface QualityTotals {
  records_count: number;
  total_output_qty: number | null;
  total_defect_qty: number | null;
  total_good_qty: number | null;
  quality_sum: number | null;
  records_above_threshold: number;
  records_below_threshold: number;
  unique_machines: number;
  shifts_analyzed: number;
}

interface QualityAggregate {
  totals: QualityTotals;
  machines: QualityMachineRow[];
  shifts: QualityShiftRow[];
  daily: QualityDailyRow[];
}

type QualityTrend = 'improving' | 'stable' | 'declining';

// GET /api/quality-analysis - 품질 분석 데이터 조회
export async function GET(request: NextRequest) {
  try {
    await requireUser(request, ['admin', 'engineer']);

    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const analysisType = searchParams.get('analysis_type') || 'summary'; // summary, detail, trends
    const shift = searchParams.get('shift'); // 'A', 'B', 'C', 'D'
    const qualityThreshold = parseFloat(searchParams.get('quality_threshold') || '95'); // 품질 임계값 (%)
    const detailPagination = parseDetailPagination(searchParams);

    console.info('🔍 품질 분석 API 요청:', { machineId, startDate, endDate, analysisType, shift, qualityThreshold });

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

    const { data, error: recordsError } = await supabaseAdmin.rpc('analytics_quality', {
      p_start_date: fromDateStr,
      p_end_date: toDateStr,
      p_machine_ids: machineIds.length > 0 ? machineIds : null,
      p_shifts: shifts.length > 0 ? shifts : null,
      p_quality_threshold: qualityThreshold,
    });

    if (recordsError) {
      console.error('품질 기록 조회 오류:', recordsError);
      return NextResponse.json(
        { error: 'Failed to fetch quality records' },
        { status: 500 }
      );
    }

    const aggregate = data as QualityAggregate;
    const totals = aggregate.totals;

    // 전체 품질 요약 계산
    const totalRecords = totals.records_count || 0;
    const totalOutputQty = totals.total_output_qty || 0;
    const totalDefectQty = totals.total_defect_qty || 0;
    const totalGoodQty = totals.total_good_qty || 0;
    const recordsAboveThreshold = totals.records_above_threshold || 0;
    const recordsBelowThreshold = totals.records_below_threshold || 0;

    const avgQuality = calculateWeightedQualityPercent(totalOutputQty, totalDefectQty);
    const overallDefectRate = totalOutputQty > 0 ? (totalDefectQty / totalOutputQty) * 100 : 0;
    const qualityComplianceRate = totalRecords > 0 ? (recordsAboveThreshold / totalRecords) * 100 : 0;

    // 설비별 품질 분석 (RPC 가 최초 등장 순으로 돌려주므로 기존 삽입 순서와 동일하다)
    const machineAnalysis = aggregate.machines.map(machine => {
      // 트렌드 분석 (첫 절반 vs 후 절반 비교)
      let quality_trend: QualityTrend = 'stable';
      if (machine.records_count >= 4) {
        const difference = (machine.second_half_avg || 0) - (machine.first_half_avg || 0);
        if (difference > QUALITY_TREND_THRESHOLD_PP) {
          quality_trend = 'improving';
        } else if (difference < -QUALITY_TREND_THRESHOLD_PP) {
          quality_trend = 'declining';
        }
      }

      return {
        machine_id: machine.machine_id,
        machine_name: machine.machine_name,
        equipment_type: machine.equipment_type,
        records_count: machine.records_count,
        total_output: machine.total_output,
        total_defects: machine.total_defects,
        total_good: machine.total_good,
        // 레코드 단순 평균이 아닌 총 양품수/총 생산수 비율로 계산 (Simpson's paradox 방지, defect_rate와 동일한 방식)
        avg_quality: machine.total_output > 0 ? (machine.total_good / machine.total_output) * 100 : 0,
        defect_rate: machine.total_output > 0 ? (machine.total_defects / machine.total_output) * 100 : 0,
        best_quality_day: machine.best_quality_day || '',
        worst_quality_day: machine.worst_quality_day || '',
        quality_trend,
        compliance_rate: machine.records_count > 0 ? (machine.compliant_count / machine.records_count) * 100 : 0,
        // 품질 변동성 (표준편차) - 퍼센트 포인트 단위
        quality_variance: machine.quality_variance,
      };
    }).sort((a, b) => b.avg_quality - a.avg_quality);

    // 교대별 품질 분석
    const shiftAnalysis = aggregate.shifts.map(shiftRow => ({
      shift: shiftRow.shift,
      records_count: shiftRow.records_count,
      total_output: shiftRow.total_output,
      total_defects: shiftRow.total_defects,
      avg_quality: calculateWeightedQualityPercent(shiftRow.total_output, shiftRow.total_defects),
      defect_rate: shiftRow.total_output > 0 ? (shiftRow.total_defects / shiftRow.total_output) * 100 : 0,
      compliance_rate: shiftRow.records_count > 0 ? (shiftRow.compliant_count / shiftRow.records_count) * 100 : 0,
      machines_count: shiftRow.machines_count,
    })).sort((a, b) => b.avg_quality - a.avg_quality);

    // 일별 품질 트렌드
    const sortedDailyQuality = aggregate.daily.map(day => ({
      date: day.date,
      total_output: day.total_output,
      total_defects: day.total_defects,
      avg_quality: calculateWeightedQualityPercent(day.total_output, day.total_defects),
      defect_rate: day.total_output > 0 ? (day.total_defects / day.total_output) * 100 : 0,
      compliance_rate: day.records_count > 0 ? (day.compliant_count / day.records_count) * 100 : 0,
      records_count: day.records_count,
      active_machines: day.active_machines,
    })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // 품질 분류 (우수/양호/개선필요/불량)
    const qualityCategories = {
      excellent: machineAnalysis.filter(m => m.avg_quality >= 98).length, // 98% 이상
      good: machineAnalysis.filter(m => m.avg_quality >= 95 && m.avg_quality < 98).length, // 95-98%
      needs_improvement: machineAnalysis.filter(m => m.avg_quality >= 90 && m.avg_quality < 95).length, // 90-95%
      poor: machineAnalysis.filter(m => m.avg_quality < 90).length // 90% 미만
    };

    // Best/Worst 성과 분석 (설비 수가 적을 때 상위/하위 목록이 겹치지 않도록 구성)
    const bestCount = Math.min(5, machineAnalysis.length);
    const worstCount = Math.min(5, machineAnalysis.length - bestCount);
    const bestPerformers = machineAnalysis.slice(0, bestCount);
    const worstPerformers = machineAnalysis.slice(machineAnalysis.length - worstCount).reverse();

    // 상세 레코드는 요청이 있을 때만 원본 행을 조회한다 (집계 경로에서는 원본을 가져오지 않는다)
    let detailedRecords: Array<Record<string, unknown>> | undefined;
    let detailTotal: number | undefined;
    if (analysisType === 'detail') {
      let detailQuery = supabaseAdmin
        .from('production_records')
        .select(`
          record_id,
          machine_id,
          date,
          shift,
          quality,
          output_qty,
          defect_qty,
          machines!inner(name)
        `, { count: 'exact' })
        .gte('date', fromDateStr)
        .lte('date', toDateStr)
        .not('output_qty', 'is', null)
        .not('defect_qty', 'is', null)
        .gt('output_qty', 0)
        .order('date', { ascending: false })
        .order('record_id', { ascending: false });

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

      const { data: detailRows, error: detailError, count } = await detailQuery.range(
        detailPagination.offset,
        detailPagination.offset + detailPagination.limit - 1
      );

      if (detailError) {
        console.error('품질 기록 상세 조회 오류:', detailError);
        return NextResponse.json(
          { error: 'Failed to fetch quality records' },
          { status: 500 }
        );
      }

      detailedRecords = (detailRows || []).map(record => ({
        record_id: record.record_id,
        machine_id: record.machine_id,
        machine_name: unwrapJoin(record.machines)?.name || 'Unknown',
        date: record.date,
        shift: record.shift,
        quality: Math.round(toQualityPercent(record.quality) * 100) / 100,
        output_qty: record.output_qty,
        defect_qty: record.defect_qty,
        good_qty: (record.output_qty || 0) - (record.defect_qty || 0),
        defect_rate: record.output_qty > 0 ? Math.round(((record.defect_qty / record.output_qty) * 100) * 100) / 100 : 0,
        meets_threshold: toQualityPercent(record.quality) >= qualityThreshold
      }));
      detailTotal = count || 0;
    }

    // 응답 구성
    const response = {
      summary: {
        analysis_period: {
          start_date: fromDateStr,
          end_date: toDateStr,
          days: Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)),
          total_records: totalRecords,
          quality_threshold: qualityThreshold
        },
        overall_quality: {
          avg_quality: Math.round(avgQuality * 100) / 100,
          total_output_qty: totalOutputQty,
          total_defect_qty: totalDefectQty,
          total_good_qty: totalGoodQty,
          overall_defect_rate: Math.round(overallDefectRate * 100) / 100,
          quality_compliance_rate: Math.round(qualityComplianceRate * 100) / 100,
          records_above_threshold: recordsAboveThreshold,
          records_below_threshold: recordsBelowThreshold
        },
        quality_distribution: qualityCategories,
        unique_machines: totals.unique_machines,
        shifts_analyzed: totals.shifts_analyzed
      },
      machine_analysis: machineAnalysis.map(m => ({
        ...m,
        avg_quality: Math.round(m.avg_quality * 100) / 100,
        defect_rate: Math.round(m.defect_rate * 100) / 100,
        compliance_rate: Math.round(m.compliance_rate * 100) / 100,
        quality_variance: Math.round(m.quality_variance * 100) / 100
      })),
      shift_analysis: shiftAnalysis.map(s => ({
        ...s,
        avg_quality: Math.round(s.avg_quality * 100) / 100,
        defect_rate: Math.round(s.defect_rate * 100) / 100,
        compliance_rate: Math.round(s.compliance_rate * 100) / 100
      })),
      quality_ranking: {
        best_performers: bestPerformers.map(m => ({
          machine_id: m.machine_id,
          machine_name: m.machine_name,
          avg_quality: Math.round(m.avg_quality * 100) / 100,
          defect_rate: Math.round(m.defect_rate * 100) / 100,
          compliance_rate: Math.round(m.compliance_rate * 100) / 100
        })),
        worst_performers: worstPerformers.map(m => ({
          machine_id: m.machine_id,
          machine_name: m.machine_name,
          avg_quality: Math.round(m.avg_quality * 100) / 100,
          defect_rate: Math.round(m.defect_rate * 100) / 100,
          compliance_rate: Math.round(m.compliance_rate * 100) / 100
        }))
      },
      trends: {
        daily: sortedDailyQuality.map(trend => ({
          ...trend,
          avg_quality: Math.round(trend.avg_quality * 100) / 100,
          defect_rate: Math.round(trend.defect_rate * 100) / 100,
          compliance_rate: Math.round(trend.compliance_rate * 100) / 100
        }))
      },
      detailed_records: detailedRecords,
      detail_pagination: analysisType === 'detail' ? {
        limit: detailPagination.limit,
        offset: detailPagination.offset,
        returned: detailedRecords?.length || 0,
        total: detailTotal || 0,
        has_more: detailPagination.offset + (detailedRecords?.length || 0) < (detailTotal || 0),
      } : undefined,
      metadata: {
        query_time: new Date().toISOString(),
        filters: {
          machine_id: machineId,
          start_date: startDate,
          end_date: endDate,
          shift: shift,
          quality_threshold: qualityThreshold,
          analysis_type: analysisType
        }
      }
    };

    console.info('✅ 품질 분석 완료:', {
      평균품질: avgQuality,
      총생산량: totalOutputQty,
      불량률: overallDefectRate,
      준수율: qualityComplianceRate,
      설비수: response.summary.unique_machines
    });

    return NextResponse.json(response);

  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('❌ 품질 분석 API 오류:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
