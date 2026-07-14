import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * 일일 OEE 정합성 보정 (daily-oee-aggregation)
 *
 * ══ 이 함수가 절대 하지 않는 일 ══════════════════════════════════════════
 *
 * ● 생산 기록을 새로 만들지 않는다 (INSERT 없음)
 *
 *   생산 수량과 비가동 시간은 작업자가 직접 입력한다. 입력이 없다는 것은
 *   "그 교대의 실적이 0" 이 아니라 "아직 입력되지 않았다" 이다.
 *   (야간조는 20:00 에 시작한다. 주간조 실적을 저장하는 시점에 야간조는 시작도 하지 않았다)
 *
 *   이전 구현은 실적이 없는 설비·교대에도 output_qty=0 / oee=0 인 행을 INSERT 했다.
 *   활성 설비 800대 × 2교대 = 실행 1회당 최대 1,600개의 유령 행이 생기고, 그 0% 들이
 *   평균 OEE 를 끌어내렸다. 휴무로 삭제한 기록까지 되살아났다.
 *
 * ● 작업자가 입력한 값을 덮어쓰지 않는다
 *
 *   건드리지 않는 컬럼:
 *     planned_runtime, actual_runtime, output_qty, defect_qty, downtime_minutes, availability
 *
 *   이전 구현은 machine_logs 의 NORMAL_OPERATION 구간에서 actual_runtime 을 재계산하고
 *   planned_runtime 을 12시간 고정값으로 덮어썼다. 그러나 이 시스템의 가동률은 로그가 아니라
 *   작업자가 입력한 비가동에서 나온다:
 *       planned_runtime = operating_minutes - break_time
 *       actual_runtime  = planned_runtime - 입력된 비가동
 *   게다가 machine_logs 는 상태 버튼을 누를 때만 남는 희소한 감사 로그다
 *   (설비 800대에 8개월 누적 5,351건). 대부분의 교대에는 로그가 아예 없어
 *   로그 기반 재계산은 actual_runtime=0 → 가동률 0% → OEE 0% 로 정상 실적을 뭉갠다.
 *   원본 operating_minutes 는 DB 에 저장되지 않으므로 한 번 덮어쓰면 복구할 수 없다.
 *
 * ● 지표를 "다시 유도" 하지 않는다
 *
 *   이 DB 의 과거 지표는 여러 세대의 쓰기 경로가 남긴 것이라, 저장된 입력값과 일관되지 않다.
 *   실측(2026-07-14): 저장된 입력값으로 파생 지표를 다시 계산하면 32.6만 행 중 93% 가 바뀐다.
 *   특히 레거시 16만 행은 planned_runtime=0 인데 가동률이 0.94 로 저장돼 있어,
 *   재계산하면 가동률이 0 이 되고 OEE 도 0 이 된다.
 *   즉 "재계산" 은 이 데이터에서 곧 역사 덮어쓰기다. 하지 않는다.
 *
 * ══ 이 함수가 하는 일 ═══════════════════════════════════════════════════
 *
 * 추가 정보 없이 **확정적으로 참인 명제** 하나만 적용해 정합성을 바로잡는다:
 *
 *     생산 수량이 0이면  →  이론 생산시간 = 0,  성능 = 0,  품질 = 0,  OEE = 0
 *
 * tact time 도, planned_runtime 도 필요 없다. 산술적으로 반박 불가능한 관계다.
 * (품질 = 양품/생산 이므로 생산이 0이면 품질은 0이고, OEE = 가동률 × 성능 × 품질 이므로 0이다)
 *
 * 실측(2026-07-14): 이 조건을 위반하는 행이 47,748건 있으며 전부 옛 쓰기 경로의 잔재다.
 * 최근 7일에는 0건 — 현재 저장 경로는 일관되게 쓴다.
 * 따라서 일상 실행(어제/오늘)에서는 바꿀 것이 없어 완전한 무해·멱등 동작이 된다.
 *
 * dry_run: true 를 주면 계산만 하고 DB 에 쓰지 않는다 (영향 범위 확인용).
 */

interface ProductionRecordRow {
  record_id: string;
  machine_id: string;
  date: string;
  shift: 'A' | 'B';
  ideal_runtime: number | null;
  output_qty: number;
  performance: number | null;
  quality: number | null;
  oee: number | null;
}

// 공장 표준시간대 (system_settings.general.timezone = 'Asia/Ho_Chi_Minh', UTC+7, DST 없음)
const PLANT_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** 주어진 시각을 공장 현지 시간 기준 'YYYY-MM-DD' 로 변환 */
function getLocalDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PLANT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/** 생산 수량이 0인데 파생 지표가 0이 아니면 정합성이 깨진 것이다. */
function isInconsistentEmptyShift(row: ProductionRecordRow): boolean {
  if ((row.output_qty ?? 0) > 0) return false;

  return (
    Number(row.ideal_runtime ?? 0) !== 0 ||
    Number(row.performance ?? 0) !== 0 ||
    Number(row.quality ?? 0) !== 0 ||
    Number(row.oee ?? 0) !== 0
  );
}

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 날짜는 supabase.functions.invoke() 가 보내는 POST 바디({ date })로 전달된다.
    // 바디가 없으면 쿼리스트링(?date=), 그것도 없으면 오늘(현지 날짜)로 폴백한다.
    const url = new URL(req.url);
    let bodyDateStr: string | undefined;
    let dryRun = false;

    try {
      const body = await req.json();
      if (body && typeof body.date === 'string' && body.date.trim() !== '') {
        bodyDateStr = body.date;
      }
      if (body && body.dry_run === true) {
        dryRun = true;
      }
    } catch (_e) {
      // 바디가 비어 있거나 JSON 이 아님 - 쿼리스트링/기본값으로 폴백
    }

    const targetDateStr = bodyDateStr || url.searchParams.get('date') || getLocalDateString(new Date());
    if (url.searchParams.get('dry_run') === 'true') {
      dryRun = true;
    }

    console.log(`Starting OEE consistency check for ${targetDateStr}${dryRun ? ' (dry run)' : ''}`);

    // 해당 날짜에 **이미 존재하는** 기록만 본다. 없는 기록을 만들지 않는다.
    const { data: records, error: recordsError } = await supabase
      .from('production_records')
      .select('record_id, machine_id, date, shift, ideal_runtime, output_qty, performance, quality, oee')
      .eq('date', targetDateStr);

    if (recordsError) {
      throw new Error(`Failed to fetch production records: ${recordsError.message}`);
    }

    const rows = (records || []) as ProductionRecordRow[];
    const broken = rows.filter(isInconsistentEmptyShift);

    console.log(`Examined ${rows.length} records, found ${broken.length} inconsistent`);

    const repaired: unknown[] = [];
    let failed = 0;

    for (const row of broken) {
      // 생산이 0이므로 이 네 값은 산술적으로 반드시 0이다.
      // planned_runtime / actual_runtime / output_qty / defect_qty / downtime_minutes /
      // availability 는 작업자 입력(또는 그로부터 저장된 값)이므로 손대지 않는다.
      const next = {
        ideal_runtime: 0,
        performance: 0,
        quality: 0,
        oee: 0
      };

      if (!dryRun) {
        const { error: updateError } = await supabase
          .from('production_records')
          .update(next)
          .eq('record_id', row.record_id);

        if (updateError) {
          console.error(`Failed to repair record ${row.record_id}:`, updateError);
          failed++;
          continue;
        }
      }

      repaired.push({
        record_id: row.record_id,
        machine_id: row.machine_id,
        shift: row.shift,
        before: {
          ideal_runtime: row.ideal_runtime,
          performance: row.performance,
          quality: row.quality,
          oee: row.oee
        },
        after: next
      });
    }

    console.log(
      `Completed. examined=${rows.length} repaired=${repaired.length} failed=${failed} created=0${dryRun ? ' (dry run - nothing written)' : ''}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        date: targetDateStr,
        dry_run: dryRun,
        examined: rows.length,
        repaired: repaired.length,
        failed,
        // 이 함수는 기록을 새로 만들지 않는다. 항상 0이다.
        created: 0,
        // 기존 호출부(OEEAggregationService)와의 호환을 위해 유지한다.
        processed_records: repaired.length,
        results: repaired
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Error in daily OEE consistency check:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
