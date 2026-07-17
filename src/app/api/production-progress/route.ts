import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ProgressBody {
  machine_id?: unknown;
  date?: unknown;
  shift?: unknown;
  shift_output_qty?: unknown;
}

/**
 * POST /api/production-progress — 교대 중 진행 보고 저장 (append-only).
 *
 * shift_output_qty 의 의미는 "이 교대에서 지금까지 만든 총 개수"다. 누적이므로 줄어들 수
 * 없고, 줄어든 값이 오면 오타이거나 예기치 못한 상황이다. 조용히 받으면 그 차이만큼
 * 생산량이 증발하므로 409 로 되묻는다.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const body = (await request.json()) as ProgressBody;

    const machineId = typeof body.machine_id === 'string' ? body.machine_id : '';
    const date = typeof body.date === 'string' ? body.date : '';
    const shift = body.shift === 'A' || body.shift === 'B' ? body.shift : null;
    const qty = typeof body.shift_output_qty === 'number' ? body.shift_output_qty : Number.NaN;

    if (!UUID.test(machineId)) {
      return NextResponse.json({ error: 'machine_id must be a UUID' }, { status: 400 });
    }
    if (!DATE.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (shift === null) {
      return NextResponse.json({ error: "shift must be 'A' or 'B'" }, { status: 400 });
    }
    if (!Number.isInteger(qty) || qty < 0) {
      return NextResponse.json({ error: 'shift_output_qty must be a non-negative integer' }, { status: 400 });
    }

    assertMachineAccess(user, machineId);

    const { data: last, error: lastError } = await supabaseAdmin
      .from('production_progress_reports')
      .select('shift_output_qty')
      .eq('machine_id', machineId)
      .eq('date', date)
      .eq('shift', shift)
      .order('reported_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastError) {
      console.error('진행 보고 조회 오류:', lastError);
      return NextResponse.json({ error: 'Failed to read last report' }, { status: 500 });
    }

    if (last && qty < last.shift_output_qty) {
      return NextResponse.json(
        {
          error: 'shift_output_qty decreased',
          last_reported_qty: last.shift_output_qty,
          submitted_qty: qty,
        },
        { status: 409 }
      );
    }

    const { error: insertError } = await supabaseAdmin
      .from('production_progress_reports')
      .insert({
        machine_id: machineId,
        date,
        shift,
        shift_output_qty: qty,
        operator_id: user.userId,
      });

    if (insertError) {
      console.error('진행 보고 저장 오류:', insertError);
      return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
