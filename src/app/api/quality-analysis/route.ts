import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/quality-analysis - 품질 분석 데이터 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const analysisType = searchParams.get('analysis_type') || 'summary'; // summary, detail, trends
    const shift = searchParams.get('shift'); // 'A', 'B', 'C', 'D'
    const qualityThreshold = parseFloat(searchParams.get('quality_threshold') || '95'); // 품질 임계값 (%)

    console.info('🔍 품질 분석 API 요청:', { machineId, startDate, endDate, analysisType, shift, qualityThreshold });

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
        quality,
        output_qty,
        defect_qty,
        created_at,
        machines!inner(name, equipment_type, location)
      `)
      .gte('date', fromDate.toISOString().split('T')[0])
      .lte('date', toDate.toISOString().split('T')[0])
      .not('output_qty', 'is', null)
      .not('defect_qty', 'is', null)
      .gt('output_qty', 0)
      .order('date', { ascending: false });

    // 설비 필터링
    if (machineId) {
      baseQuery = baseQuery.eq('machine_id', machineId);
    }

    // 교대 필터링
    if (shift) {
      baseQuery = baseQuery.eq('shift', shift);
    }

    const { data: qualityRecords, error: recordsError } = await baseQuery;

    if (recordsError) {
      console.error('품질 기록 조회 오류:', recordsError);
      return NextResponse.json(
        { error: 'Failed to fetch quality records' },
        { status: 500 }
      );
    }

    // 전체 품질 요약 계산
    const totalRecords = qualityRecords?.length || 0;
    let totalOutputQty = 0;
    let totalDefectQty = 0;
    let totalGoodQty = 0;
    let qualitySum = 0;
    let recordsAboveThreshold = 0;
    let recordsBelowThreshold = 0;

    (qualityRecords || []).forEach(record => {
      const outputQty = record.output_qty || 0;
      const defectQty = record.defect_qty || 0;
      const goodQty = outputQty - defectQty;
      const quality = record.quality || 0;

      totalOutputQty += outputQty;
      totalDefectQty += defectQty;
      totalGoodQty += goodQty;
      qualitySum += quality;

      if (quality >= qualityThreshold) {
        recordsAboveThreshold++;
      } else {
        recordsBelowThreshold++;
      }
    });

    const avgQuality = totalRecords > 0 ? qualitySum / totalRecords : 0;
    const overallDefectRate = totalOutputQty > 0 ? (totalDefectQty / totalOutputQty) * 100 : 0;
    const qualityComplianceRate = totalRecords > 0 ? (recordsAboveThreshold / totalRecords) * 100 : 0;

    // 설비별 품질 분석
    const machineQuality: Record<string, {
      machine_id: string;
      machine_name: string;
      equipment_type: string;
      records_count: number;
      total_output: number;
      total_defects: number;
      total_good: number;
      avg_quality: number;
      defect_rate: number;
      best_quality_day: string;
      worst_quality_day: string;
      quality_trend: 'improving' | 'stable' | 'declining';
      compliance_rate: number;
      quality_variance: number;
    }> = {};

    (qualityRecords || []).forEach(record => {
      const machineId = record.machine_id;
      const machineName = record.machines?.name || 'Unknown';
      const equipmentType = record.machines?.equipment_type || 'Unknown';

      if (!machineQuality[machineId]) {
        machineQuality[machineId] = {
          machine_id: machineId,
          machine_name: machineName,
          equipment_type: equipmentType,
          records_count: 0,
          total_output: 0,
          total_defects: 0,
          total_good: 0,
          avg_quality: 0,
          defect_rate: 0,
          best_quality_day: '',
          worst_quality_day: '',
          quality_trend: 'stable',
          compliance_rate: 0,
          quality_variance: 0
        };
      }

      const machine = machineQuality[machineId];
      machine.records_count++;
      machine.total_output += record.output_qty || 0;
      machine.total_defects += record.defect_qty || 0;
      machine.total_good += (record.output_qty || 0) - (record.defect_qty || 0);
      machine.avg_quality += record.quality || 0;
    });

    // 설비별 통계 완성 및 트렌드 분석
    const machineAnalysis = Object.values(machineQuality).map(machine => {
      machine.avg_quality = machine.avg_quality / machine.records_count;
      machine.defect_rate = machine.total_output > 0 ? (machine.total_defects / machine.total_output) * 100 : 0;

      // 해당 설비의 모든 기록
      const machineRecords = (qualityRecords || [])
        .filter(r => r.machine_id === machine.machine_id)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // 품질 준수율 계산
      const compliantRecords = machineRecords.filter(r => (r.quality || 0) >= qualityThreshold);
      machine.compliance_rate = machineRecords.length > 0 ? (compliantRecords.length / machineRecords.length) * 100 : 0;

      // 품질 변동성 (표준편차) 계산
      const qualities = machineRecords.map(r => r.quality || 0);
      const avgQuality = qualities.reduce((sum, q) => sum + q, 0) / qualities.length;
      const variance = qualities.reduce((sum, q) => sum + Math.pow(q - avgQuality, 2), 0) / qualities.length;
      machine.quality_variance = Math.sqrt(variance);

      // 최고/최저 품질일 찾기
      if (machineRecords.length > 0) {
        const sortedByQuality = [...machineRecords].sort((a, b) => (b.quality || 0) - (a.quality || 0));
        machine.best_quality_day = sortedByQuality[0]?.date || '';
        machine.worst_quality_day = sortedByQuality[sortedByQuality.length - 1]?.date || '';

        // 트렌드 분석 (첫 절반 vs 후 절반 비교)
        if (machineRecords.length >= 4) {
          const midPoint = Math.floor(machineRecords.length / 2);
          const firstHalf = machineRecords.slice(0, midPoint);
          const secondHalf = machineRecords.slice(midPoint);
          
          const firstAvg = firstHalf.reduce((sum, r) => sum + (r.quality || 0), 0) / firstHalf.length;
          const secondAvg = secondHalf.reduce((sum, r) => sum + (r.quality || 0), 0) / secondHalf.length;
          
          const difference = secondAvg - firstAvg;
          if (difference > 1) {
            machine.quality_trend = 'improving';
          } else if (difference < -1) {
            machine.quality_trend = 'declining';
          } else {
            machine.quality_trend = 'stable';
          }
        }
      }

      return machine;
    }).sort((a, b) => b.avg_quality - a.avg_quality);

    // 교대별 품질 분석
    const shiftQuality: Record<string, {
      shift: string;
      records_count: number;
      total_output: number;
      total_defects: number;
      avg_quality: number;
      defect_rate: number;
      compliance_rate: number;
      machines_count: number;
    }> = {};

    (qualityRecords || []).forEach(record => {
      const shift = record.shift;
      if (!shiftQuality[shift]) {
        shiftQuality[shift] = {
          shift,
          records_count: 0,
          total_output: 0,
          total_defects: 0,
          avg_quality: 0,
          defect_rate: 0,
          compliance_rate: 0,
          machines_count: 0
        };
      }

      const shiftData = shiftQuality[shift];
      shiftData.records_count++;
      shiftData.total_output += record.output_qty || 0;
      shiftData.total_defects += record.defect_qty || 0;
      shiftData.avg_quality += record.quality || 0;
    });

    const shiftAnalysis = Object.values(shiftQuality).map(shift => {
      shift.avg_quality = shift.avg_quality / shift.records_count;
      shift.defect_rate = shift.total_output > 0 ? (shift.total_defects / shift.total_output) * 100 : 0;
      
      // 교대별 품질 준수율
      const shiftRecords = (qualityRecords || []).filter(r => r.shift === shift.shift);
      const compliantRecords = shiftRecords.filter(r => (r.quality || 0) >= qualityThreshold);
      shift.compliance_rate = shiftRecords.length > 0 ? (compliantRecords.length / shiftRecords.length) * 100 : 0;
      
      // 해당 교대의 고유 설비 수
      const uniqueMachines = new Set(shiftRecords.map(r => r.machine_id));
      shift.machines_count = uniqueMachines.size;

      return shift;
    }).sort((a, b) => b.avg_quality - a.avg_quality);

    // 일별 품질 트렌드
    const dailyQuality: Record<string, {
      date: string;
      total_output: number;
      total_defects: number;
      avg_quality: number;
      defect_rate: number;
      compliance_rate: number;
      records_count: number;
      active_machines: number;
    }> = {};

    (qualityRecords || []).forEach(record => {
      const date = record.date;
      if (!dailyQuality[date]) {
        dailyQuality[date] = {
          date,
          total_output: 0,
          total_defects: 0,
          avg_quality: 0,
          defect_rate: 0,
          compliance_rate: 0,
          records_count: 0,
          active_machines: 0
        };
      }

      const day = dailyQuality[date];
      day.records_count++;
      day.total_output += record.output_qty || 0;
      day.total_defects += record.defect_qty || 0;
      day.avg_quality += record.quality || 0;
    });

    const sortedDailyQuality = Object.values(dailyQuality).map(day => {
      day.avg_quality = day.avg_quality / day.records_count;
      day.defect_rate = day.total_output > 0 ? (day.total_defects / day.total_output) * 100 : 0;
      
      // 일별 품질 준수율
      const dayRecords = (qualityRecords || []).filter(r => r.date === day.date);
      const compliantRecords = dayRecords.filter(r => (r.quality || 0) >= qualityThreshold);
      day.compliance_rate = dayRecords.length > 0 ? (compliantRecords.length / dayRecords.length) * 100 : 0;
      
      // 일별 활성 설비 수
      const activeMachines = new Set(dayRecords.map(r => r.machine_id));
      day.active_machines = activeMachines.size;

      return day;
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // 품질 분류 (우수/양호/개선필요/불량)
    const qualityCategories = {
      excellent: machineAnalysis.filter(m => m.avg_quality >= 98).length, // 98% 이상
      good: machineAnalysis.filter(m => m.avg_quality >= 95 && m.avg_quality < 98).length, // 95-98%
      needs_improvement: machineAnalysis.filter(m => m.avg_quality >= 90 && m.avg_quality < 95).length, // 90-95%
      poor: machineAnalysis.filter(m => m.avg_quality < 90).length // 90% 미만
    };

    // 응답 구성
    const response = {
      summary: {
        analysis_period: {
          start_date: fromDate.toISOString().split('T')[0],
          end_date: toDate.toISOString().split('T')[0],
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
        unique_machines: new Set((qualityRecords || []).map(r => r.machine_id)).size,
        shifts_analyzed: new Set((qualityRecords || []).map(r => r.shift)).size
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
        best_performers: machineAnalysis.slice(0, 5).map(m => ({
          machine_id: m.machine_id,
          machine_name: m.machine_name,
          avg_quality: Math.round(m.avg_quality * 100) / 100,
          defect_rate: Math.round(m.defect_rate * 100) / 100,
          compliance_rate: Math.round(m.compliance_rate * 100) / 100
        })),
        worst_performers: machineAnalysis.slice(-5).reverse().map(m => ({
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
      detailed_records: analysisType === 'detail' ? (qualityRecords || []).map(record => ({
        record_id: record.record_id,
        machine_id: record.machine_id,
        machine_name: record.machines?.name || 'Unknown',
        date: record.date,
        shift: record.shift,
        quality: record.quality,
        output_qty: record.output_qty,
        defect_qty: record.defect_qty,
        good_qty: (record.output_qty || 0) - (record.defect_qty || 0),
        defect_rate: record.output_qty > 0 ? Math.round(((record.defect_qty / record.output_qty) * 100) * 100) / 100 : 0,
        meets_threshold: (record.quality || 0) >= qualityThreshold
      })) : undefined,
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
    console.error('❌ 품질 분석 API 오류:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}