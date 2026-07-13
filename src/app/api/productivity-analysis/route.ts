import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { unwrapJoin } from '@/types';

export const dynamic = 'force-dynamic';

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

    let baseQuery = supabaseAdmin
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
        machines!inner(name, equipment_type, location)
      `)
      .gte('date', fromDate.toISOString().split('T')[0])
      .lte('date', toDate.toISOString().split('T')[0])
      .order('date', { ascending: false });

    // 설비 필터링 (단일 ID 또는 콤마로 구분된 다중 ID 지원)
    if (machineId) {
      const machineIds = machineId.split(',').map(id => id.trim()).filter(Boolean);
      if (machineIds.length > 1) {
        baseQuery = baseQuery.in('machine_id', machineIds);
      } else if (machineIds.length === 1) {
        baseQuery = baseQuery.eq('machine_id', machineIds[0]);
      }
    }

    // 교대 필터링 (단일 값 또는 콤마로 구분된 다중 값 지원)
    if (shift) {
      const shifts = shift.split(',').map(s => s.trim()).filter(Boolean);
      if (shifts.length > 1) {
        baseQuery = baseQuery.in('shift', shifts);
      } else if (shifts.length === 1) {
        baseQuery = baseQuery.eq('shift', shifts[0]);
      }
    }

    const { data: productionRecords, error: recordsError } = await baseQuery;

    if (recordsError) {
      console.error('생산 기록 조회 오류:', recordsError);
      return NextResponse.json(
        { error: 'Failed to fetch production records' },
        { status: 500 }
      );
    }

    // 전체 생산성 요약 계산
    const totalRecords = productionRecords?.length || 0;
    let totalPlannedRuntime = 0;
    let totalActualRuntime = 0;
    let totalOutputQty = 0;
    let totalGoodQty = 0;
    let totalDefectQty = 0;

    const avgAvailability = productionRecords?.reduce((sum, record) => sum + (record.availability || 0), 0) / totalRecords || 0;
    const avgPerformance = productionRecords?.reduce((sum, record) => sum + (record.performance || 0), 0) / totalRecords || 0;
    const avgQuality = productionRecords?.reduce((sum, record) => sum + (record.quality || 0), 0) / totalRecords || 0;
    const avgOEE = productionRecords?.reduce((sum, record) => sum + (record.oee || 0), 0) / totalRecords || 0;

    // 누적 합계 계산
    (productionRecords || []).forEach(record => {
      totalPlannedRuntime += record.planned_runtime || 0;
      totalActualRuntime += record.actual_runtime || 0;
      totalOutputQty += record.output_qty || 0;
      totalDefectQty += record.defect_qty || 0;
      totalGoodQty += (record.output_qty || 0) - (record.defect_qty || 0);
    });

    // 설비별 생산성 분석
    const machineProductivity: Record<string, {
      machine_id: string;
      machine_name: string;
      equipment_type: string;
      records_count: number;
      avg_oee: number;
      avg_availability: number;
      avg_performance: number;
      avg_quality: number;
      total_output: number;
      total_good_qty: number;
      total_defect_qty: number;
      total_planned_runtime: number;
      total_actual_runtime: number;
      defect_rate: number;
      utilization_rate: number;
      efficiency_score: number;
      best_shift: string;
      worst_shift: string;
    }> = {};

    (productionRecords || []).forEach(record => {
      const machineId = record.machine_id;
      const machineName = unwrapJoin(record.machines)?.name || 'Unknown';
      const equipmentType = unwrapJoin(record.machines)?.equipment_type || 'Unknown';

      if (!machineProductivity[machineId]) {
        machineProductivity[machineId] = {
          machine_id: machineId,
          machine_name: machineName,
          equipment_type: equipmentType,
          records_count: 0,
          avg_oee: 0,
          avg_availability: 0,
          avg_performance: 0,
          avg_quality: 0,
          total_output: 0,
          total_good_qty: 0,
          total_defect_qty: 0,
          total_planned_runtime: 0,
          total_actual_runtime: 0,
          defect_rate: 0,
          utilization_rate: 0,
          efficiency_score: 0,
          best_shift: '',
          worst_shift: ''
        };
      }

      const machine = machineProductivity[machineId];
      machine.records_count++;
      machine.avg_performance += record.performance || 0;
      machine.avg_quality += record.quality || 0;
      machine.total_output += record.output_qty || 0;
      machine.total_defect_qty += record.defect_qty || 0;
      machine.total_good_qty += (record.output_qty || 0) - (record.defect_qty || 0);
      machine.total_planned_runtime += record.planned_runtime || 0;
      machine.total_actual_runtime += record.actual_runtime || 0;
    });

    // 설비별 평균값 계산
    const machineAnalysis = Object.values(machineProductivity).map(machine => {
      // 가동률은 레코드 단순 평균이 아닌 총 실제가동시간/총 계획가동시간 비율로 계산 (Simpson's paradox 방지)
      machine.avg_availability = machine.total_planned_runtime > 0 ? machine.total_actual_runtime / machine.total_planned_runtime : 0;
      machine.avg_performance = machine.avg_performance / machine.records_count;
      machine.avg_quality = machine.avg_quality / machine.records_count;
      // OEE = 가동률 × 성능 × 품질 정의에 따라 재계산 (oee 컬럼의 단순 평균은 레코드 수에 따라 왜곡됨)
      machine.avg_oee = machine.avg_availability * machine.avg_performance * machine.avg_quality;
      machine.defect_rate = machine.total_output > 0 ? (machine.total_defect_qty / machine.total_output) * 100 : 0;
      machine.utilization_rate = machine.avg_availability;
      machine.efficiency_score = (machine.avg_oee * 0.4) + (machine.avg_performance * 0.3) + (machine.avg_quality * 0.3);

      // 설비별 기록 필터링
      const machineRecords = (productionRecords || []).filter(r => r.machine_id === machine.machine_id);

      // 최고/최저 성과 교대 찾기
      const shiftPerformance: Record<string, { total: number, count: number }> = {};
      machineRecords.forEach(record => {
        const shift = record.shift;
        if (!shiftPerformance[shift]) {
          shiftPerformance[shift] = { total: 0, count: 0 };
        }
        shiftPerformance[shift].total += record.oee || 0;
        shiftPerformance[shift].count++;
      });

      const shiftAvgs = Object.entries(shiftPerformance).map(([shift, data]) => ({
        shift,
        avg: data.total / data.count
      })).sort((a, b) => b.avg - a.avg);

      machine.best_shift = shiftAvgs[0]?.shift || '';
      machine.worst_shift = shiftAvgs[shiftAvgs.length - 1]?.shift || '';

      return machine;
    }).sort((a, b) => b.avg_oee - a.avg_oee);

    // 교대별 생산성 분석
    const shiftAnalysis: Record<string, {
      shift: string;
      records_count: number;
      avg_oee: number;
      avg_availability: number;
      avg_performance: number;
      avg_quality: number;
      total_output: number;
      total_good_qty: number;
      defect_rate: number;
      machines_count: number;
    }> = {};

    (productionRecords || []).forEach(record => {
      const shift = record.shift;
      if (!shiftAnalysis[shift]) {
        shiftAnalysis[shift] = {
          shift,
          records_count: 0,
          avg_oee: 0,
          avg_availability: 0,
          avg_performance: 0,
          avg_quality: 0,
          total_output: 0,
          total_good_qty: 0,
          defect_rate: 0,
          machines_count: new Set().size
        };
      }

      shiftAnalysis[shift].records_count++;
      shiftAnalysis[shift].avg_oee += record.oee || 0;
      shiftAnalysis[shift].avg_availability += record.availability || 0;
      shiftAnalysis[shift].avg_performance += record.performance || 0;
      shiftAnalysis[shift].avg_quality += record.quality || 0;
      shiftAnalysis[shift].total_output += record.output_qty || 0;
      shiftAnalysis[shift].total_good_qty += (record.output_qty || 0) - (record.defect_qty || 0);
    });

    // 교대별 평균값 계산
    const shiftSummary = Object.values(shiftAnalysis).map(shift => {
      const count = shift.records_count;
      shift.avg_oee = shift.avg_oee / count;
      shift.avg_availability = shift.avg_availability / count;
      shift.avg_performance = shift.avg_performance / count;
      shift.avg_quality = shift.avg_quality / count;
      shift.defect_rate = shift.total_output > 0 ? ((shift.total_output - shift.total_good_qty) / shift.total_output) * 100 : 0;
      
      // 해당 교대에서 활동한 고유 설비 수
      const machinesInShift = new Set((productionRecords || [])
        .filter(r => r.shift === shift.shift)
        .map(r => r.machine_id));
      shift.machines_count = machinesInShift.size;

      return shift;
    }).sort((a, b) => b.avg_oee - a.avg_oee);

    // 일별 생산성 트렌드
    const dailyTrends: Record<string, {
      date: string;
      avg_oee: number;
      avg_availability: number;
      avg_performance: number;
      avg_quality: number;
      total_output: number;
      total_good_qty: number;
      defect_rate: number;
      records_count: number;
      active_machines: number;
    }> = {};

    (productionRecords || []).forEach(record => {
      const date = record.date;
      if (!dailyTrends[date]) {
        dailyTrends[date] = {
          date,
          avg_oee: 0,
          avg_availability: 0,
          avg_performance: 0,
          avg_quality: 0,
          total_output: 0,
          total_good_qty: 0,
          defect_rate: 0,
          records_count: 0,
          active_machines: 0
        };
      }

      const day = dailyTrends[date];
      day.records_count++;
      day.avg_oee += record.oee || 0;
      day.avg_availability += record.availability || 0;
      day.avg_performance += record.performance || 0;
      day.avg_quality += record.quality || 0;
      day.total_output += record.output_qty || 0;
      day.total_good_qty += (record.output_qty || 0) - (record.defect_qty || 0);
    });

    // 일별 평균값 계산 및 정렬
    const sortedDailyTrends = Object.values(dailyTrends).map(day => {
      const count = day.records_count;
      day.avg_oee = day.avg_oee / count;
      day.avg_availability = day.avg_availability / count;
      day.avg_performance = day.avg_performance / count;
      day.avg_quality = day.avg_quality / count;
      day.defect_rate = day.total_output > 0 ? ((day.total_output - day.total_good_qty) / day.total_output) * 100 : 0;
      
      // 해당 일자 활성 설비 수
      const activeMachines = new Set((productionRecords || [])
        .filter(r => r.date === day.date)
        .map(r => r.machine_id));
      day.active_machines = activeMachines.size;

      return day;
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Top/Bottom 성과 분석 (설비 수가 적을 때 상위/하위 목록이 겹치지 않도록 구성)
    const topCount = Math.min(5, machineAnalysis.length);
    const bottomCount = Math.min(5, machineAnalysis.length - topCount);
    const topPerformers = machineAnalysis.slice(0, topCount);
    const bottomPerformers = machineAnalysis.slice(machineAnalysis.length - bottomCount).reverse();

    // 응답 구성
    const response = {
      summary: {
        analysis_period: {
          start_date: fromDate.toISOString().split('T')[0],
          end_date: toDate.toISOString().split('T')[0],
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
        unique_machines: new Set((productionRecords || []).map(r => r.machine_id)).size,
        shifts_analyzed: new Set((productionRecords || []).map(r => r.shift)).size
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
      detailed_records: analysisType === 'detail' ? (productionRecords || []).map(record => ({
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
      })) : undefined,
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