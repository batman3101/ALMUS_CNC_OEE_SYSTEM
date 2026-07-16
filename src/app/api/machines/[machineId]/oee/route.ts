import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  apiAuthErrorResponse,
  assertMachineAccess,
  requireUser,
} from '@/lib/apiAuth';
import { calculateWeightedOEE } from '@/utils/weightedOee';
import { getBusinessDateAt } from '@/utils/downtimeIntervals';

const DEFAULT_BUSINESS_CLOCK = { timezone: 'Asia/Ho_Chi_Minh', shiftAStart: '08:00' };

async function getBusinessClock() {
  const { data, error } = await supabaseAdmin
    .from('system_settings')
    .select('category, setting_key, setting_value')
    .in('category', ['general', 'shift'])
    .eq('is_active', true);
  if (error || !data) return DEFAULT_BUSINESS_CLOCK;
  const value = (category: string, key: string): string | undefined => {
    const setting = data.find(row => row.category === category && row.setting_key === key)
      ?.setting_value as { value?: unknown } | null | undefined;
    return typeof setting?.value === 'string' ? setting.value : undefined;
  };
  return {
    timezone: value('general', 'timezone') || DEFAULT_BUSINESS_CLOCK.timezone,
    shiftAStart: value('shift', 'shift_a_start') || DEFAULT_BUSINESS_CLOCK.shiftAStart,
  };
}

const isDateOnly = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const round3 = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 1000) / 1000;

// GET /api/machines/[machineId]/oee - 특정 설비의 OEE 데이터 조회
export async function GET(
  request: NextRequest,
  { params }: { params: { machineId: string } }
) {
  try {
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { machineId } = params;
    assertMachineAccess(authenticatedUser, machineId);

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const shift = searchParams.get('shift');
    const realtime = searchParams.get('realtime') === 'true';

    if ((startDate === null) !== (endDate === null)) {
      return NextResponse.json({ error: 'start_date and end_date must be provided together' }, { status: 400 });
    }
    if (startDate && endDate && (!isDateOnly(startDate) || !isDateOnly(endDate) || startDate > endDate)) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
    }
    if (shift && shift !== 'A' && shift !== 'B') {
      return NextResponse.json({ error: 'Shift must be A or B' }, { status: 400 });
    }

    const { data: machine, error: machineError } = await supabaseAdmin
      .from('machines')
      .select('id, name, current_state, equipment_type, location, is_active, updated_at')
      .eq('id', machineId)
      .single();
    if (machineError || !machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 });
    }

    if (realtime) {
      const currentTime = new Date();
      const businessClock = await getBusinessClock();
      const businessDate = getBusinessDateAt(
        currentTime,
        businessClock.timezone,
        businessClock.shiftAStart
      );
      const [{ data: latestRecord }, { data: todayRecords, error: todayError }] = await Promise.all([
        supabaseAdmin
          .from('production_records')
          .select('*')
          .eq('machine_id', machineId)
          .eq('date', businessDate)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from('production_records')
          .select('planned_runtime, actual_runtime, output_qty, defect_qty, downtime_minutes')
          .eq('machine_id', machineId)
          .eq('date', businessDate),
      ]);
      if (todayError) {
        return NextResponse.json({ error: 'Failed to fetch today production records' }, { status: 500 });
      }

      const todaySummary = (todayRecords || []).reduce((sum, record) => ({
        total_output: sum.total_output + toNumber(record.output_qty),
        defect_count: sum.defect_count + toNumber(record.defect_qty),
        runtime_minutes: sum.runtime_minutes + toNumber(record.actual_runtime),
        planned_minutes: sum.planned_minutes + toNumber(record.planned_runtime),
        reported_records: sum.reported_records + (record.downtime_minutes === null ? 0 : 1),
        unreported_records: sum.unreported_records + (record.downtime_minutes === null ? 1 : 0),
      }), {
        total_output: 0,
        defect_count: 0,
        runtime_minutes: 0,
        planned_minutes: 0,
        reported_records: 0,
        unreported_records: 0,
      });
      const efficiency = todaySummary.planned_minutes > 0
        ? todaySummary.runtime_minutes / todaySummary.planned_minutes
        : 0;

      return NextResponse.json({
        realtime_oee: {
          machine_id: machineId,
          machine_name: machine.name,
          timestamp: currentTime.toISOString(),
          business_date: businessDate,
          current_state: machine.current_state,
          oee: toNullableNumber(latestRecord?.oee),
          availability: toNullableNumber(latestRecord?.availability),
          performance: toNullableNumber(latestRecord?.performance),
          quality: toNullableNumber(latestRecord?.quality),
          // machine_logs는 상태 구간이지 가공 사이클 텔레메트리가 아니다.
          current_cycle: null,
          today_summary: {
            ...todaySummary,
            efficiency: round3(efficiency),
          },
        },
        machine_info: machine,
      });
    }

    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 30);
    const effectiveStartDate = startDate || defaultStart.toISOString().split('T')[0];
    const pageSize = 1000;
    const productionRecords: Array<Record<string, unknown>> = [];

    for (let from = 0; ; from += pageSize) {
      let query = supabaseAdmin
        .from('production_records')
        .select('*')
        .eq('machine_id', machineId)
        .gte('date', effectiveStartDate)
        .order('date', { ascending: false })
        .order('record_id', { ascending: false })
        .range(from, from + pageSize - 1);
      if (endDate) query = query.lte('date', endDate);
      if (shift) query = query.eq('shift', shift);

      const { data, error } = await query;
      if (error) {
        console.error('Error fetching production records:', error);
        return NextResponse.json({ error: 'Failed to fetch production records' }, { status: 500 });
      }
      productionRecords.push(...((data || []) as Array<Record<string, unknown>>));
      if (!data || data.length < pageSize) break;
    }

    const oeeData = productionRecords.map(record => ({
      id: record.record_id,
      machine_id: record.machine_id,
      date: record.date,
      shift: record.shift,
      availability: toNullableNumber(record.availability),
      performance: toNullableNumber(record.performance),
      quality: toNullableNumber(record.quality),
      oee: toNullableNumber(record.oee),
      actual_runtime: toNullableNumber(record.actual_runtime),
      planned_runtime: toNullableNumber(record.planned_runtime),
      ideal_runtime: toNullableNumber(record.ideal_runtime),
      output_qty: toNumber(record.output_qty),
      defect_qty: toNumber(record.defect_qty),
      downtime_minutes: record.downtime_minutes === null
        ? null
        : toNullableNumber(record.downtime_minutes),
      created_at: record.created_at,
    }));

    const reportedRows = oeeData.filter(record =>
      record.downtime_minutes !== null
      && record.planned_runtime !== null
      && record.actual_runtime !== null
      && record.ideal_runtime !== null
      && !(record.output_qty <= 0 && (
        (record.oee ?? 0) !== 0
        || (record.quality ?? 0) !== 0
        || record.ideal_runtime !== 0
      ))
    );
    const totals = reportedRows.reduce((sum, record) => ({
      planned: sum.planned + toNumber(record.planned_runtime),
      actual: sum.actual + toNumber(record.actual_runtime),
      ideal: sum.ideal + toNumber(record.ideal_runtime),
      output: sum.output + record.output_qty,
      defects: sum.defects + record.defect_qty,
      downtime: sum.downtime + toNumber(record.downtime_minutes),
    }), { planned: 0, actual: 0, ideal: 0, output: 0, defects: 0, downtime: 0 });
    const weighted = calculateWeightedOEE({
      reportedRecords: reportedRows.length,
      totalPlannedRuntime: totals.planned,
      totalActualRuntime: totals.actual,
      totalIdealRuntime: totals.ideal,
      totalOutput: totals.output,
      totalDefects: totals.defects,
    });
    const rowOee = reportedRows
      .map(record => calculateWeightedOEE({
        reportedRecords: 1,
        totalPlannedRuntime: toNumber(record.planned_runtime),
        totalActualRuntime: toNumber(record.actual_runtime),
        totalIdealRuntime: toNumber(record.ideal_runtime),
        totalOutput: record.output_qty,
        totalDefects: record.defect_qty,
      }).oee)
      .filter((value): value is number => value !== null);

    const statistics = {
      avg_oee: round3(weighted.oee),
      avg_availability: round3(weighted.availability),
      avg_performance: round3(weighted.performance),
      avg_quality: round3(weighted.quality),
      total_output: oeeData.reduce((sum, record) => sum + record.output_qty, 0),
      total_defects: oeeData.reduce((sum, record) => sum + record.defect_qty, 0),
      total_runtime: totals.actual,
      total_downtime: totals.downtime,
      total_records: oeeData.length,
      reported_records: reportedRows.length,
      unreported_records: oeeData.length - reportedRows.length,
      best_oee: rowOee.length > 0 ? round3(Math.max(...rowOee)) : null,
      worst_oee: rowOee.length > 0 ? round3(Math.min(...rowOee)) : null,
    };

    return NextResponse.json({
      machine_id: machineId,
      machine_info: machine,
      oee_data: [...oeeData].reverse(),
      statistics,
      filters: { start_date: startDate, end_date: endDate, shift },
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error fetching machine OEE data:', error);
    return NextResponse.json({ error: 'Failed to fetch machine OEE data' }, { status: 500 });
  }
}
