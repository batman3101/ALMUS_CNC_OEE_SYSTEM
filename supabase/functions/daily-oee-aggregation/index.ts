import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  businessDateInTimezone,
  DEFAULT_PLANT_TIMEZONE,
  resolvePlantTimezone
} from './plantTimezone.ts'

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
 *
 * 대상 영업일은 요청에 date 가 없으면 **system_settings.general.timezone 기준의 오늘**이다.
 * 그 시간대를 어떻게 유도하고 왜 상수로 두지 않는지는 ./plantTimezone.ts 에 적었다.
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

/**
 * JWT 페이로드를 읽는다. **검증하지 않는다** — 이 함수는 `verify_jwt: true` 로 배포되어
 * 있어 서명 검증은 플랫폼이 이미 끝냈다. 여기서 하는 일은 검증된 토큰에서 role 클레임을
 * 꺼내는 것뿐이다.
 */
function readJwtClaims(token: string): { role?: string } | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    // base64url → base64 (JWT 는 '-'/'_' 를 쓰고 패딩을 생략한다)
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
    return JSON.parse(atob(base64));
  } catch (_e) {
    return null;
  }
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

    // ── 호출자 인가 ────────────────────────────────────────────────────────
    //
    // 이 함수는 Service Role 로 production_records 를 UPDATE 한다. 그런데 호출자의 역할을
    // 전혀 보지 않아, **유효한 JWT 를 가진 아무 로그인 사용자**(운영자 포함)나 임의 날짜를
    // 지정해 호출할 수 있었다(Codex 감사 2026-07-29 #4).
    //
    // 지금 이 함수가 쓰는 값은 output_qty=0 인 행의 파생 지표뿐이라 손상 능력이 없지만,
    // 본문이 나중에 확장되면 그 순간 권한 상승이 된다. 경계는 지금 세운다.
    //
    // service_role 분기를 둔 이유 — service_role 토큰에는 대응하는 user_profiles 행이 없어서,
    // 분기 없이 프로필만 조회하면 service_role 호출이 전부 403 이 된다.
    //
    // ⚠ 문서 정정(2026-07-29 실측): CLAUDE.md 와 docs/OEE_AGGREGATION_SYSTEM.md 는 이 함수가
    //   pg_cron 으로 매일 08:30 / 20:30 에 자동 실행된다고 적어 두었지만, **이 프로젝트에는
    //   pg_cron 이 설치되어 있지 않고(installed_version=null) cron 스키마도 없다.**
    //   즉 예약 호출자는 존재하지 않으며, 현재 유일한 호출자는 관리자 UI
    //   (OEEAggregationService.triggerDailyAggregation → 브라우저 세션 JWT)다.
    //   그래도 이 분기는 유지한다 — 나중에 스케줄러를 붙일 때 필요하고, 지금 지우면
    //   그때 같은 함정을 다시 밟는다.
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: 'unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // verify_jwt: true 이므로 서명은 플랫폼이 이미 검증했다. role 클레임은 신뢰할 수 있다.
    // (브라우저 번들에 실려 있는 anon 키의 토큰은 role='anon' 이라 이 분기를 통과하지 못하고,
    //  아래 getUser 에서도 사용자로 해석되지 않아 401 이 된다)
    const callerRole = readJwtClaims(token)?.role;

    if (callerRole !== 'service_role') {
      const { data: caller, error: callerError } = await supabase.auth.getUser(token);
      if (callerError || !caller?.user) {
        return new Response(
          JSON.stringify({ success: false, error: 'unauthorized' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
        );
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role, is_active')
        .eq('user_id', caller.user.id)
        .maybeSingle();

      // 비활성 계정은 역할이 admin 이어도 거부한다(apiAuth.requireUser 와 같은 규율).
      if (!profile || profile.role !== 'admin' || profile.is_active !== true) {
        return new Response(
          JSON.stringify({ success: false, error: 'forbidden' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
        );
      }
    }

    // ── 공장 표준시간대 ────────────────────────────────────────────────────
    //
    // 이 값이 "오늘" 이 어느 날인지를 정한다. 예전에는 소스에 'Asia/Ho_Chi_Minh' 를 박아 두고
    // 주석으로 설정값이 그것과 같다고 **단언**했지만, general.timezone 은 관리자가 UI 에서
    // 바꿀 수 있다. 앱과 교대 계산은 바뀐 값을 따라가는데 이 배치만 옛 값을 쓰면 조용히
    // 다른 날의 행을 대상으로 삼는다. 그래서 단언하지 않고 매 호출마다 읽는다.
    //
    // 읽기는 인가 뒤에 둔다 — 거부할 호출자를 위해 DB 를 건드리지 않는다.
    const { data: timezoneRow, error: timezoneError } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('category', 'general')
      .eq('setting_key', 'timezone')
      .eq('is_active', true)
      .maybeSingle();

    const timezoneResolution = resolvePlantTimezone({
      settingValue: timezoneRow?.setting_value,
      // maybeSingle 은 행이 없으면 error 없이 data=null 을 준다. 따라서 error 가 있다는 것은
      // "행이 없다" 가 아니라 "읽지 못했다" 뿐이다.
      queryError: timezoneError?.message ?? null
    });

    // 설정은 있는데 시간대로 쓸 수 없는 값이면 기본값으로 때우지 않고 거부한다. 인식되지
    // 않는 시간대를 UTC 로 대신 해석하면 07:00 이전 호출이 하루 전 날짜를 조용히 고르고,
    // 배치는 성공으로 끝난다 — 오류보다 나쁘다. 대상 날짜를 명시해 부른 경우에도 거부한다:
    // 이 설정이 깨졌다는 사실 자체가 다음 실행에서 날짜를 어긋나게 하므로 지금 드러내야 한다.
    if (timezoneResolution.status === 'invalid') {
      console.error(`Refusing to run: ${timezoneResolution.detail}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'invalid_plant_timezone',
          configured_timezone: timezoneResolution.configured,
          message: timezoneResolution.detail
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const plantTimezone = timezoneResolution.timezone;
    // "설정을 읽어 보니 기본값과 같았다" 와 "설정을 못 읽어 기본값을 썼다" 는 다른 사실이다.
    // 두 경우의 timezone 문자열이 같으므로, 출처를 따로 실어야 구분할 수 있다.
    const timezoneSource = timezoneResolution.status === 'configured' ? 'system_settings' : 'default';
    const timezoneFallbackReason =
      timezoneResolution.status === 'fallback' ? timezoneResolution.reason : null;

    if (timezoneResolution.status === 'fallback') {
      console.warn(
        `Plant timezone fell back to ${DEFAULT_PLANT_TIMEZONE} (${timezoneResolution.reason}): ${timezoneResolution.detail}`
      );
    }

    // 날짜는 supabase.functions.invoke() 가 보내는 POST 바디({ date })로 전달된다.
    // 바디가 없으면 쿼리스트링(?date=), 그것도 없으면 오늘(공장 현지 날짜)로 폴백한다.
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

    const targetDateStr =
      bodyDateStr || url.searchParams.get('date') || businessDateInTimezone(new Date(), plantTimezone);
    if (url.searchParams.get('dry_run') === 'true') {
      dryRun = true;
    }

    console.log(
      `Starting OEE consistency check for ${targetDateStr}` +
      ` (timezone ${plantTimezone} from ${timezoneSource}${timezoneFallbackReason ? `: ${timezoneFallbackReason}` : ''})` +
      `${dryRun ? ' (dry run)' : ''}`
    );

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
        // 어느 시간대로 그 날짜를 정했는지, 그 시간대가 설정에서 온 것인지 폴백인지 함께 싣는다.
        // 이것이 없으면 "설정대로 돌았다" 와 "설정을 못 읽어 기본값으로 돌았다" 가 응답에서
        // 똑같아 보인다.
        plant_timezone: plantTimezone,
        plant_timezone_source: timezoneSource,
        plant_timezone_fallback_reason: timezoneFallbackReason,
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
