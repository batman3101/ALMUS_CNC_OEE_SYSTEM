import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/oee-data/by-machine - 설비별 OEE 집계 (기간 + 교대 필터 적용)
 *
 * 엔지니어 화면의 "설비별 성능 분석" 표는 지금까지 useRealtimeData 가 들고 있는
 *   - 설비별 **최신 실적 1건** (기간 무관)
 *   - **전역 최근 로그 100개** (실측: 800대 중 34대만 커버)
 * 로 계산되고 있었다. 화면 상단의 기간/교대 필터는 이 표에 아예 반영되지 않아,
 * 같은 화면의 카드·추세와 표가 서로 다른 기간을 말하고 있었다.
 *
 * 집계는 SQL 에서 수행한다. 원시 행을 Node 로 가져와 평균 내면 PostgREST 의 max-rows(10만)에
 * 걸려 일부만 평균한 값을 전체인 양 보고하게 된다.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const machineIdParam = searchParams.get('machine_id'); // 단일 또는 콤마 구분
    const shiftParam = searchParams.get('shift'); // 'A' | 'B' | 'A,B'

    if (!startDate) {
      return NextResponse.json(
        { success: false, error: 'start_date is required' },
        { status: 400 }
      );
    }

    const machineIds = machineIdParam
      ? machineIdParam.split(',').map(id => id.trim()).filter(Boolean)
      : null;

    const shifts = shiftParam
      ? shiftParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : null;

    const { data, error } = await supabaseAdmin.rpc('analytics_oee_by_machine', {
      p_start_date: startDate,
      p_end_date: endDate || null,
      p_machine_ids: machineIds,
      p_shifts: shifts
    });

    if (error) {
      console.error('analytics_oee_by_machine error:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to aggregate OEE by machine' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      machines: data ?? [],
      filters: {
        start_date: startDate,
        end_date: endDate,
        machine_id: machineIdParam,
        shift: shiftParam
      }
    });
  } catch (error) {
    console.error('Error in GET /api/oee-data/by-machine:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
