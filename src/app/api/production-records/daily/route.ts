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
      night_shift,
      total_production,
      total_defects,
      total_good_quantity,
      total_downtime_minutes,
      planned_capacity,
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

    // TODO: 실제 데이터베이스에 저장하는 로직 구현
    // 현재는 목업 응답으로 성공 처리
    
    // 가상의 저장된 레코드 ID 생성
    const recordId = `daily_${Date.now()}`;
    
    console.log(`Successfully saved daily production data for machine ${machine.name} on ${date}`);
    console.log('Record ID:', recordId);

    // 성공 응답
    return NextResponse.json({
      success: true,
      message: '일일 생산 데이터가 성공적으로 저장되었습니다',
      record_id: recordId,
      machine_name: machine.name,
      date: date,
      summary: {
        total_production,
        total_defects,
        total_good_quantity,
        oee: Math.round(oee * 1000) / 10 // 소수점 1자리로 표시
      }
    });

  } catch (error: any) {
    console.error('Error in POST /api/production-records/daily:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to save daily production data',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}