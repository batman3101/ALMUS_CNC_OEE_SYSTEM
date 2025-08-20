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

    // 실시간 데이터인 경우
    if (realtime) {
      const currentTime = new Date();
      const availability = 0.75 + Math.random() * 0.2;
      const performance = 0.80 + Math.random() * 0.15;
      const quality = 0.90 + Math.random() * 0.08;
      const oee = availability * performance * quality;

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
          started_at: new Date(currentTime.getTime() - 120000).toISOString(), // 2분 전 시작
          expected_duration: machine.default_tact_time,
          current_duration: 120,
          progress: 0.8,
        },
        today_summary: {
          total_output: 95,
          defect_count: 2,
          runtime_minutes: 480,
          planned_minutes: 500,
          efficiency: 0.85,
        }
      };

      return NextResponse.json({
        realtime_oee: realtimeData,
        machine_info: machine
      });
    }

    // 히스토리 데이터 생성
    const generateHistoricalOEE = (days: number) => {
      return Array.from({ length: days }, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() - index);
        
        // 설비별로 약간 다른 성능 특성 부여
        let baseAvailability = 0.80;
        let basePerformance = 0.85;
        let baseQuality = 0.92;
        
        if (machineId.includes('1')) {
          baseAvailability = 0.85;
          basePerformance = 0.80;
        } else if (machineId.includes('2')) {
          basePerformance = 0.90;
          baseQuality = 0.88;
        }

        const availability = baseAvailability + (Math.random() - 0.5) * 0.2;
        const performance = basePerformance + (Math.random() - 0.5) * 0.15;
        const quality = baseQuality + (Math.random() - 0.5) * 0.1;
        const oee = availability * performance * quality;

        return {
          id: `oee_${machineId}_${index}`,
          machine_id: machineId,
          date: date.toISOString().split('T')[0],
          shift: ['A', 'B'][index % 2] as 'A' | 'B',
          availability: Math.max(0.5, Math.min(1, availability)),
          performance: Math.max(0.5, Math.min(1, performance)),
          quality: Math.max(0.8, Math.min(1, quality)),
          oee: Math.max(0.4, Math.min(1, oee)),
          actual_runtime: Math.round(availability * 500),
          planned_runtime: 500,
          ideal_runtime: Math.round(performance * availability * 500),
          output_qty: Math.round((80 + Math.random() * 40) * availability * performance),
          defect_qty: Math.round(Math.random() * 10 * (1 - quality)),
          downtime_minutes: Math.round((1 - availability) * 500),
          created_at: date.toISOString(),
        };
      }).map(data => ({
        ...data,
        availability: Math.round(data.availability * 1000) / 1000,
        performance: Math.round(data.performance * 1000) / 1000,
        quality: Math.round(data.quality * 1000) / 1000,
        oee: Math.round(data.oee * 1000) / 1000,
      }));
    };

    let oeeData = generateHistoricalOEE(30); // 기본 30일

    // 날짜 필터 적용
    if (startDate && endDate) {
      oeeData = oeeData.filter(data => 
        data.date >= startDate && data.date <= endDate
      );
    }

    // 교대 필터 적용
    if (shift) {
      oeeData = oeeData.filter(data => data.shift === shift);
    }

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