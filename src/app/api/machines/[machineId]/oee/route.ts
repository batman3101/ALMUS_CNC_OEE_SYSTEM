import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/machines/[machineId]/oee - 특정 설비의 OEE 데이터 조회
export async function GET(
  request: NextRequest,
  { params }: { params: { machineId: string } }
) {
  try {
    const { machineId } = params;
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const shift = searchParams.get('shift');
    const realtime = searchParams.get('realtime') === 'true';

    // 설비 존재 확인
    const { data: machine, error: machineError } = await supabaseAdmin
      .from('machines')
      .select('*')
      .eq('id', machineId)
      .single();

    if (machineError || !machine) {
      return NextResponse.json(
        { error: 'Machine not found' },
        { status: 404 }
      );
    }

    // 실시간 데이터인 경우 - 실제 데이터 기반
    if (realtime) {
      const currentTime = new Date();
      const today = currentTime.toISOString().split('T')[0];
      
      // 오늘의 최신 생산 기록 조회
      const { data: latestRecord } = await supabaseAdmin
        .from('production_records')
        .select('*')
        .eq('machine_id', machineId)
        .eq('date', today)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // 현재 실행 중인 machine_log 조회
      const { data: currentLog } = await supabaseAdmin
        .from('machine_logs')
        .select('*')
        .eq('machine_id', machineId)
        .is('end_time', null)
        .order('start_time', { ascending: false })
        .limit(1)
        .single();

      // 오늘의 전체 생산 기록 조회 (집계용)
      const { data: todayRecords } = await supabaseAdmin
        .from('production_records')
        .select('*')
        .eq('machine_id', machineId)
        .eq('date', today);

      // 실제 데이터가 없으면 기본값 사용
      const availability = latestRecord ? parseFloat(latestRecord.availability) : 0.0;
      const performance = latestRecord ? parseFloat(latestRecord.performance) : 0.0;
      const quality = latestRecord ? parseFloat(latestRecord.quality) : 0.0;
      const oee = latestRecord ? parseFloat(latestRecord.oee) : 0.0;

      // 오늘 집계 데이터 계산
      const todaySummary = todayRecords?.reduce((sum, record) => ({
        total_output: sum.total_output + (record.output_qty || 0),
        defect_count: sum.defect_count + (record.defect_qty || 0),
        runtime_minutes: sum.runtime_minutes + (record.actual_runtime || 0),
        planned_minutes: sum.planned_minutes + (record.planned_runtime || 0),
      }), { total_output: 0, defect_count: 0, runtime_minutes: 0, planned_minutes: 0 }) || 
      { total_output: 0, defect_count: 0, runtime_minutes: 0, planned_minutes: 0 };

      const efficiency = todaySummary.planned_minutes > 0 ? 
        todaySummary.runtime_minutes / todaySummary.planned_minutes : 0;

      // 현재 사이클 정보 계산
      const cycleStartTime = currentLog ? new Date(currentLog.start_time) : 
        new Date(currentTime.getTime() - 120000); // 기본 2분 전
      const currentDuration = Math.floor((currentTime.getTime() - cycleStartTime.getTime()) / 1000);
      const expectedDuration = machine.current_process?.tact_time_seconds || 120;
      const progress = Math.min(currentDuration / expectedDuration, 1.0);

      const realtimeData = {
        machine_id: machineId,
        machine_name: machine.name,
        timestamp: currentTime.toISOString(),
        current_state: machine.current_state,
        oee: Math.round(oee * 1000) / 1000,
        availability: Math.round(availability * 1000) / 1000,
        performance: Math.round(performance * 1000) / 1000,
        quality: Math.round(quality * 1000) / 1000,
        current_cycle: {
          started_at: cycleStartTime.toISOString(),
          expected_duration: expectedDuration,
          current_duration: currentDuration,
          progress: Math.round(progress * 1000) / 1000,
        },
        today_summary: {
          total_output: todaySummary.total_output,
          defect_count: todaySummary.defect_count,
          runtime_minutes: todaySummary.runtime_minutes,
          planned_minutes: todaySummary.planned_minutes,
          efficiency: Math.round(efficiency * 1000) / 1000,
        }
      };

      return NextResponse.json({
        realtime_oee: realtimeData,
        machine_info: machine
      });
    }

    // 히스토리 데이터 조회 - 실제 production_records에서 가져오기
    let query = supabaseAdmin
      .from('production_records')
      .select('*')
      .eq('machine_id', machineId)
      .order('date', { ascending: false });

    // 날짜 필터 적용
    if (startDate && endDate) {
      query = query.gte('date', startDate).lte('date', endDate);
    } else {
      // 기본적으로 최근 30일 데이터
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      query = query.gte('date', thirtyDaysAgo.toISOString().split('T')[0]);
    }

    // 교대 필터 적용
    if (shift) {
      query = query.eq('shift', shift);
    }

    const { data: productionRecords, error: recordsError } = await query;

    if (recordsError) {
      console.error('Error fetching production records:', recordsError);
      return NextResponse.json(
        { error: 'Failed to fetch production records' },
        { status: 500 }
      );
    }

    // production_records 데이터를 API 응답 형식에 맞게 변환
    const oeeData = (productionRecords || []).map(record => ({
      id: record.record_id,
      machine_id: record.machine_id,
      date: record.date,
      shift: record.shift,
      availability: parseFloat(record.availability) || 0,
      performance: parseFloat(record.performance) || 0,
      quality: parseFloat(record.quality) || 0,
      oee: parseFloat(record.oee) || 0,
      actual_runtime: record.actual_runtime || 0,
      planned_runtime: record.planned_runtime || 480,
      ideal_runtime: record.ideal_runtime || 0,
      output_qty: record.output_qty || 0,
      defect_qty: record.defect_qty || 0,
      downtime_minutes: Math.max(0, (record.planned_runtime || 480) - (record.actual_runtime || 0)),
      created_at: record.created_at,
    })).map(data => ({
      ...data,
      availability: Math.round(data.availability * 1000) / 1000,
      performance: Math.round(data.performance * 1000) / 1000,
      quality: Math.round(data.quality * 1000) / 1000,
      oee: Math.round(data.oee * 1000) / 1000,
    }));

    // 필터링은 이미 쿼리에서 처리됨

    // 통계 계산
    const totalRecords = oeeData.length;
    const statistics = totalRecords > 0 ? {
      avg_oee: oeeData.reduce((sum, data) => sum + data.oee, 0) / totalRecords,
      avg_availability: oeeData.reduce((sum, data) => sum + data.availability, 0) / totalRecords,
      avg_performance: oeeData.reduce((sum, data) => sum + data.performance, 0) / totalRecords,
      avg_quality: oeeData.reduce((sum, data) => sum + data.quality, 0) / totalRecords,
      total_output: oeeData.reduce((sum, data) => sum + data.output_qty, 0),
      total_defects: oeeData.reduce((sum, data) => sum + data.defect_qty, 0),
      total_runtime: oeeData.reduce((sum, data) => sum + data.actual_runtime, 0),
      total_downtime: oeeData.reduce((sum, data) => sum + data.downtime_minutes, 0),
      best_oee: Math.max(...oeeData.map(data => data.oee)),
      worst_oee: Math.min(...oeeData.map(data => data.oee)),
    } : {};

    return NextResponse.json({
      machine_id: machineId,
      machine_info: machine,
      oee_data: oeeData.reverse(), // 시간순 정렬
      statistics: Object.fromEntries(
        Object.entries(statistics).map(([key, value]) => 
          [key, typeof value === 'number' ? Math.round(value * 1000) / 1000 : value]
        )
      ),
      filters: {
        start_date: startDate,
        end_date: endDate,
        shift
      }
    });
  } catch (error) {
    console.error('Error fetching machine OEE data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch machine OEE data' },
      { status: 500 }
    );
  }
}