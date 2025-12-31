import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { DailyProductionData } from '@/types/dataInput';

// POST /api/production-records/daily - 일일 생산 데이터 저장
export async function POST(request: NextRequest) {
  try {
    console.log('POST /api/production-records/daily called');

    const body: DailyProductionData = await request.json();
    console.log('Received daily production data:', body);

    const {
      machine_id,
      date,
      day_shift,
      day_shift_off,
      night_shift,
      night_shift_off,
      total_production,
      total_defects,
      total_good_quantity,
      availability,
      performance,
      quality,
      oee
    } = body;

    // 필수 필드 검증
    if (!machine_id || !date) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Machine ID and date are required' 
        },
        { status: 400 }
      );
    }

    // 설비 존재 확인
    const { data: machine, error: machineError } = await supabaseAdmin
      .from('machines')
      .select('id, name')
      .eq('id', machine_id)
      .single();

    if (machineError || !machine) {
      console.error('Machine not found:', machineError);
      return NextResponse.json(
        { 
          success: false,
          error: 'Machine not found' 
        },
        { status: 404 }
      );
    }

    // 실제 데이터베이스에 저장하는 로직
    const savedRecords = [];

    // 주간 교대 데이터 저장 (휴무가 아닌 경우 - 생산량 0이어도 저장 가능)
    if (day_shift && !day_shift_off) {
      const dayShiftRecord = {
        machine_id,
        date,
        shift: 'A', // 주간 교대
        planned_runtime: Math.max(0, (day_shift.end_time && day_shift.start_time ? 
          (new Date(`${date} ${day_shift.end_time}`).getTime() - new Date(`${date} ${day_shift.start_time}`).getTime()) / (1000 * 60) :
          720)), // 기본 12시간 = 720분
        actual_runtime: Math.max(0, 720 - (day_shift.total_downtime_minutes || 0)),
        ideal_runtime: 720, // 이상적인 가동시간 (12시간)
        output_qty: day_shift.actual_production,
        defect_qty: day_shift.defect_quantity,
        availability: availability || 0,
        performance: performance || 0,
        quality: quality || 0,
        oee: oee || 0
      };

      const { data: dayRecord, error: dayError } = await supabaseAdmin
        .from('production_records')
        .upsert(dayShiftRecord, { 
          onConflict: 'machine_id,date,shift',
          ignoreDuplicates: false 
        })
        .select()
        .single();

      if (dayError) {
        console.error('Error saving day shift data:', dayError);
        throw new Error(`주간 교대 데이터 저장 실패: ${dayError.message}`);
      }
      
      savedRecords.push(dayRecord);
      console.log('Day shift record saved:', dayRecord.record_id);
    }

    // 야간 교대 데이터 저장 (휴무가 아닌 경우 - 생산량 0이어도 저장 가능)
    if (night_shift && !night_shift_off) {
      const nightShiftRecord = {
        machine_id,
        date,
        shift: 'B', // 야간 교대
        planned_runtime: Math.max(0, (night_shift.end_time && night_shift.start_time ?
          (new Date(`${date} ${night_shift.end_time}`).getTime() - new Date(`${date} ${night_shift.start_time}`).getTime()) / (1000 * 60) :
          720)), // 기본 12시간 = 720분
        actual_runtime: Math.max(0, 720 - (night_shift.total_downtime_minutes || 0)),
        ideal_runtime: 720, // 이상적인 가동시간 (12시간)
        output_qty: night_shift.actual_production,
        defect_qty: night_shift.defect_quantity,
        availability: availability || 0,
        performance: performance || 0,
        quality: quality || 0,
        oee: oee || 0
      };

      const { data: nightRecord, error: nightError } = await supabaseAdmin
        .from('production_records')
        .upsert(nightShiftRecord, { 
          onConflict: 'machine_id,date,shift',
          ignoreDuplicates: false 
        })
        .select()
        .single();

      if (nightError) {
        console.error('Error saving night shift data:', nightError);
        throw new Error(`야간 교대 데이터 저장 실패: ${nightError.message}`);
      }
      
      savedRecords.push(nightRecord);
      console.log('Night shift record saved:', nightRecord.record_id);
    }
    
    console.log(`Successfully saved ${savedRecords.length} production records for machine ${machine.name} on ${date}`);

    // 양쪽 교대조 모두 휴무인 경우
    if (day_shift_off && night_shift_off) {
      return NextResponse.json({
        success: true,
        message: `${date} - 주간조/야간조 모두 휴무로 설정되어 생산 기록이 저장되지 않았습니다.`,
        records_saved: 0,
        record_ids: [],
        machine_name: machine.name,
        date: date,
        is_holiday: true
      });
    }

    // 성공 응답
    return NextResponse.json({
      success: true,
      message: `일일 생산 데이터가 성공적으로 저장되었습니다 (${savedRecords.length}개 레코드)`,
      records_saved: savedRecords.length,
      record_ids: savedRecords.map(r => r.record_id),
      machine_name: machine.name,
      date: date,
      summary: {
        total_production,
        total_defects,
        total_good_quantity,
        oee: Math.round(oee * 1000) / 10 // 소수점 1자리로 표시 (%)
      },
      saved_records: savedRecords
    });

  } catch (error: unknown) {
    console.error('Error in POST /api/production-records/daily:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to save daily production data',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}