-- 적대적 재감사 #6 · #5 — 마감이 보는 "원천"의 정의를 완성한다.
--
-- ══ #6: 지문이 OEE 를 바꾸는 차원을 빠뜨렸다 ═══════════════════════════════════
--
-- `downtime_window_digest` 는 source·source_id·start_time·end_time 만 해시했다.
-- 그런데 비가동 시간을 정하는 재료는 그게 전부가 아니다. `reason`(machine_logs 는
-- `state`)이 계획정지 여부를 정하고, 그 분류가 확정 비가동 값을 **통째로 바꾼다**:
--
--   src/app/api/production-records/daily/downtimeCalculation.ts:56-69
--     계획정지가 하나라도 있고 휴식 시간이 설정돼 있으면 → **null 반환**
--     (휴식과 계획정지의 겹침을 알 수 없어 이중 차감을 막는 규칙)
--
-- 즉 분류가 뒤집히면 비가동 분이 조금 달라지는 게 아니라 **숫자 ↔ NULL 이 뒤집힌다.**
-- availability 와 OEE 가 계산 가능한지 자체가 달라진다.
--
-- 그리고 이 경로는 이론이 아니다. 진행 중 비가동의 **사유 정정**(`correct_open_downtime_
-- reason`)이 바로 `start_time` 을 그대로 두고 `reason` 만 바꾼다 — 정확히 지문이 못 보는
-- 변경이다. 라우트가 행을 읽은 뒤 RPC 가 지문을 대조하기 전에 정정이 들어오면, 지문은
-- 같고 대조는 통과하고 **낡은 분류로 계산한 지표가 확정 저장된다.**
--
-- 교훈: 낙관적 동시성의 지문은 "무엇이 바뀔 수 있는가"가 아니라 **"결과를 무엇이
-- 결정하는가"** 를 덮어야 한다. 시간만 세고 분류를 안 셌다.
--
-- 뷰가 이미 reason 을 노출하므로 한 컬럼 추가로 끝난다. 시그니처는 그대로라
-- `create or replace` 가 오버로드를 만들지 않는다(배포 창 없음).

create or replace function public.downtime_window_digest(
  p_machine_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- 행이 하나도 없을 때 string_agg 는 NULL 을 돌려준다. NULL 을 그대로 쓰면 "비가동 없음"과
  -- "계산 실패"가 구분되지 않으므로 명시적인 상수로 접는다.
  select coalesce(
    md5(string_agg(
      source || ':' || source_id::text || ':' ||
      -- reason 이 계획/비계획 분류를 정하고, 그 분류가 확정 비가동 값을 바꾼다.
      -- 이게 빠져 있어서 사유 정정이 지문에 잡히지 않았다(재감사 #6).
      coalesce(reason, '') || ':' ||
      extract(epoch from start_time)::text || ':' ||
      coalesce(extract(epoch from end_time)::text, 'open'),
      '|' order by source, source_id::text
    )),
    'empty'
  )
  from public.machine_downtime_intervals
  where machine_id = p_machine_id
    and start_time < p_window_end
    and (end_time is null or end_time > p_window_start)
$$;

-- ══ #5: 진척 입력과 교대 마감이 겹쳤고, 마감은 수량을 잠금 밖에서 읽었다 ═══════
--
-- 진척은 `window.end + buffer`(운영값 10분)까지 받고, 마감은 정확히 `window.end` 부터
-- 허용했다. 그 10분 동안 두 경로가 같은 (machine, date, shift) 를 두고 겹친다.
--
--   1. 마감 요청이 진척 수량 100 을 읽는다        ← 잠금 **밖**
--   2. 유예 시간 안에 진척 110 이 승인된다
--   3. 마감 RPC 가 뒤늦게 잠금을 얻고 100 을 확정 저장한다
--
-- append-only 원천은 110 인데 확정 레코드는 100 이고, 레코드가 이미 존재하므로 마감대기
-- 탐지도 재마감을 요구하지 않는다. 조용히 어긋난 채 남는다.
--
-- ## 왜 CAS(지문 대조)로 풀지 않았나
--
-- #6 처럼 "수량 지문을 넘겨 잠금 아래에서 대조"하는 방법이 자연스러워 보인다. 그러려면
-- `close_shift_upsert_v2` 에 인자를 하나 더해야 하고, 인자가 바뀌면 `create or replace`
-- 가 **오버로드**를 만들기 때문에 v3 신설 → 코드 배포 → v2 DROP 의 3단계가 또 필요하다
-- (CLAUDE.md 의 규약). 하루 전에 v1→v2 로 그 과정을 막 끝냈다.
--
-- 그런데 더 나은 답이 있다: **경합을 탐지하는 대신 없앤다.**
--   (a) 마감 허용 시작을 `window.end + buffer` 로 옮긴다 → 두 시간창이 서로소가 된다.
--       라우트 층에서 한 줄이고, RPC 시그니처는 그대로다.
--   (b) 그래도 남는 것은 **이미 출발한** 진척 요청이다. 유예 안에서 시간창 검사를 통과한
--       뒤 잠금 앞에서 대기하다가, 마감이 먼저 잠금을 얻어 저장한 다음에 삽입될 수 있다.
--       이건 아래 `already_closed` 가드가 **같은 잠금 아래에서** 막는다.
--
-- 탐지는 "틀린 값을 저장하지 않는다"까지고, 예방은 "어긋난 상태가 생기지 않는다"다.
-- 가능하면 뒤쪽이 낫다.
--
-- (a) 는 `src/app/api/production-records/close-shift/route.ts` 에 있다.

create or replace function public.report_shift_progress(
  p_machine_id uuid,
  p_date date,
  p_shift text,
  p_qty integer,
  p_operator_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  prev integer;
  down_state text;
  v_active boolean;
begin
  -- andon(toggle_machine_downtime)과 동일 키 — 비가동 검사·삽입을 andon 전이와 직렬화한다.
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended(p_machine_id::text || p_date::text || p_shift, 0)
  );

  -- 행 잠금과 함께 읽는다(20260729060000 규약). advisory lock 만으로는 RPC 밖의 직접
  -- UPDATE 와 배제되지 않는다.
  select is_active into v_active
  from public.machines
  where id = p_machine_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'machine_not_found');
  end if;

  if not v_active then
    return jsonb_build_object('ok', false, 'reason', 'machine_inactive');
  end if;

  -- 이 교대가 이미 확정됐으면 진척은 받지 않는다(재감사 #5).
  --
  -- **이 검사는 반드시 잠금 안에 있어야 한다.** 막으려는 것이 정확히 "마감이 잠금을 쥐고
  -- 저장하는 동안 앞에서 대기하던 진척 요청"이기 때문이다. 라우트에서 미리 확인하면 그
  -- 조회와 이 삽입 사이가 비어 있어 같은 경합이 그대로 남는다.
  --
  -- 마감 뒤의 진척을 그냥 넣어두면 원천(110)과 확정 레코드(100)가 어긋난 채 남고, 화면은
  -- 레코드가 있다는 이유로 재마감을 요구하지 않는다 — 아무도 모르는 불일치가 된다.
  -- 거부하면 작업자가 "이미 마감됨"을 즉시 보고 정정 경로(마감 다시 하기)로 갈 수 있다.
  if exists (
    select 1 from public.production_records
    where machine_id = p_machine_id and date = p_date and shift = p_shift
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_closed');
  end if;

  -- 통합 비가동 확인. "지금 열려 있으면 비가동".
  select ml.state into down_state
  from public.machine_logs ml
  where ml.machine_id = p_machine_id
    and ml.end_time is null
    and ml.state <> 'NORMAL_OPERATION'
  order by ml.start_time desc
  limit 1;

  if down_state is not null then
    return jsonb_build_object('ok', false, 'reason', 'machine_in_downtime', 'state', down_state);
  end if;

  if exists (
    select 1 from public.downtime_entries de
    where de.machine_id = p_machine_id and de.end_time is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'machine_in_downtime', 'state', 'downtime_entry');
  end if;

  select max(shift_output_qty) into prev
  from public.production_progress_reports
  where machine_id = p_machine_id
    and date = p_date
    and shift = p_shift;

  if prev is not null and p_qty < prev then
    return jsonb_build_object('ok', false, 'reason', 'decreased', 'last_reported_qty', prev);
  end if;

  insert into public.production_progress_reports(machine_id, date, shift, shift_output_qty, operator_id)
  values (p_machine_id, p_date, p_shift, p_qty, p_operator_id);

  return jsonb_build_object('ok', true);
end;
$$;
