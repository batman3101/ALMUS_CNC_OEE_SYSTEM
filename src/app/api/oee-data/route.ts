import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// GET /api/oee-data - OEE 데이터 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const shift = searchParams.get('shift');
    const aggregation = searchParams.get('aggregation') || 'daily'; // daily, weekly, monthly

    // 실제 Supabase 데이터베이스에서 production_records 조회
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
        machines!inner(name, equipment_type, location)
      `)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    // 날짜 범위 필터링
    if (startDate && endDate) {
      query = query.gte('date', startDate).lte('date', endDate);
    } else {
      // 기본적으로 최근 데이터 조회
      let days = 7;
      if (aggregation === 'weekly') days = 7;
      else if (aggregation === 'monthly') days = 30;
      else if (aggregation === 'yearly') days = 365;
      
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      query = query.gte('date', fromDate.toISOString().split('T')[0]);
    }

    // 설비 필터링
    if (machineId) {
      query = query.eq('machine_id', machineId);
    }

    // 교대 필터링
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

    // Mock API 형식에 맞게 데이터 변환
    const oeeData = (productionData || []).map(record => ({
      id: record.record_id,
      machine_id: record.machine_id,
      machine_name: record.machines?.name || 'Unknown',
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

    // 집계 처리 (이미 DB 쿼리에서 필터링되어 중복 필터 제거)
    let aggregatedData = oeeData;
    
    // 집계 타입에 따른 데이터 그룹핑 (추후 확장 가능)
    if (aggregation === 'weekly') {
      // 주별 집계: 7일간 데이터
      aggregatedData = oeeData;
    } else if (aggregation === 'monthly') {
      // 월별 집계: 30일간 데이터
      aggregatedData = oeeData;
    } else if (aggregation === 'yearly') {
      // 연간 집계: 365일간 데이터 
      aggregatedData = oeeData;
    }

    // 통계 계산
    const totalRecords = aggregatedData.length;
    const avgOEE = totalRecords > 0 
      ? aggregatedData.reduce((sum, data) => sum + data.oee, 0) / totalRecords 
      : 0;
    const avgAvailability = totalRecords > 0
      ? aggregatedData.reduce((sum, data) => sum + data.availability, 0) / totalRecords
      : 0;
    const avgPerformance = totalRecords > 0
      ? aggregatedData.reduce((sum, data) => sum + data.performance, 0) / totalRecords
      : 0;
    const avgQuality = totalRecords > 0
      ? aggregatedData.reduce((sum, data) => sum + data.quality, 0) / totalRecords
      : 0;

    return NextResponse.json({
      oee_data: aggregatedData,
      statistics: {
        total_records: totalRecords,
        avg_oee: Math.round(avgOEE * 1000) / 1000,
        avg_availability: Math.round(avgAvailability * 1000) / 1000,
        avg_performance: Math.round(avgPerformance * 1000) / 1000,
        avg_quality: Math.round(avgQuality * 1000) / 1000,
      },
      filters: {
        machine_id: machineId,
        start_date: startDate,
        end_date: endDate,
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