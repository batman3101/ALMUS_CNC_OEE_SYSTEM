import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { DowntimeEntry } from '@/types/dataInput';

// POST /api/downtime-entries - 비가동 시간 즉시 저장
export async function POST(request: NextRequest) {
  try {
    console.log('POST /api/downtime-entries called');

    const body: Partial<DowntimeEntry> = await request.json();
    console.log('Received downtime entry:', body);

    const {
      machine_id,
      date,
      shift,
      start_time,
      end_time,
      reason,
      description,
      operator_id
    } = body;

    // 필수 필드 검증
    if (!machine_id || !date || !shift || !start_time || !reason) {
      return NextResponse.json(
        {
          success: false,
          error: 'Machine ID, date, shift, start_time, and reason are required'
        },
        { status: 400 }
      );
    }

    // Shift 값 검증
    if (shift !== 'A' && shift !== 'B') {
      return NextResponse.json(
        {
          success: false,
          error: 'Shift must be A or B'
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

    // 기간(duration) 계산
    const startTime = new Date(start_time);
    const endTime = end_time ? new Date(end_time) : new Date();
    const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));

    // 비가동 데이터 저장
    const downtimeData = {
      machine_id,
      date,
      shift,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      duration_minutes: durationMinutes,
      reason,
      description: description || null,
      operator_id: operator_id || null
    };

    const { data: savedEntry, error: saveError } = await supabaseAdmin
      .from('downtime_entries')
      .insert(downtimeData)
      .select()
      .single();

    if (saveError) {
      console.error('Error saving downtime entry:', saveError);
      throw new Error(`비가동 시간 저장 실패: ${saveError.message}`);
    }

    console.log('Downtime entry saved successfully:', savedEntry.id);

    // 성공 응답
    return NextResponse.json({
      success: true,
      message: '비가동 시간이 성공적으로 저장되었습니다',
      data: savedEntry
    });

  } catch (error: unknown) {
    console.error('Error in POST /api/downtime-entries:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to save downtime entry',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}

// GET /api/downtime-entries - 비가동 시간 조회
export async function GET(request: NextRequest) {
  try {
    console.log('GET /api/downtime-entries called');

    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const date = searchParams.get('date');
    const shift = searchParams.get('shift');

    // 필수 파라미터 검증
    if (!machineId || !date) {
      return NextResponse.json(
        {
          success: false,
          error: 'Machine ID and date are required'
        },
        { status: 400 }
      );
    }

    // 쿼리 빌드
    let query = supabaseAdmin
      .from('downtime_entries')
      .select('*')
      .eq('machine_id', machineId)
      .eq('date', date)
      .order('start_time', { ascending: true });

    // Shift 필터 추가 (선택사항)
    if (shift) {
      if (shift !== 'A' && shift !== 'B') {
        return NextResponse.json(
          {
            success: false,
            error: 'Shift must be A or B'
          },
          { status: 400 }
        );
      }
      query = query.eq('shift', shift);
    }

    const { data: entries, error: fetchError } = await query;

    if (fetchError) {
      console.error('Error fetching downtime entries:', fetchError);
      throw new Error(`비가동 시간 조회 실패: ${fetchError.message}`);
    }

    console.log(`Found ${entries?.length || 0} downtime entries`);

    // 성공 응답
    return NextResponse.json({
      success: true,
      data: entries || [],
      count: entries?.length || 0
    });

  } catch (error: unknown) {
    console.error('Error in GET /api/downtime-entries:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch downtime entries',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}
