-- 생산실적 삭제를 마감·불량확정과 **같은 잠금** 아래로 들여놓는다.
--
-- ## 무엇이 문제였나
--
-- `delete_production_record` 는 `SELECT ... FOR UPDATE`(행 잠금)만 쓰고,
-- `close_shift_upsert_v2` 와 `confirm_shift_defect` 는 advisory lock 만 쓴다.
-- advisory lock 은 Postgres 에서 **독립된 네임스페이스**라 행 잠금과 서로를 차단하지 않는다.
-- 그래서 둘 다 "잠금이 있는" 것처럼 보였지만 상호 배제는 전혀 없었다.
--
-- 겹치면 이런 최종 상태가 가능하다:
--
--   1. 삭제가 행을 지우고 `production_shift_states.status = 'MISSING'` 을 쓴다
--   2. 그 사이 마감이 advisory lock 만 쥔 채 같은 (machine, date, shift) 행을 다시 만든다
--   3. 결과: **생산실적은 존재하는데 교대 상태는 MISSING**
--
-- `MISSING` 은 `OFF`/`HOLIDAY` 와 구분되는 값이라, 이 조합은 백로그와 미보고 집계를 조용히
-- 틀리게 만든다.
--
-- ## 왜 이런 순서인가
--
-- 잠금 키는 (machine, date, shift) 인데 이 함수는 `record_id` 만 받는다. 키를 알려면 행을
-- 먼저 읽어야 하고, 그 읽기는 잠금 밖이다 — 그 자체가 다시 TOCTOU 다.
--
-- 그래서 **읽기 → 잠금 → 재확인** 세 단계로 쓴다. 첫 읽기는 오직 키를 얻기 위한 것이고,
-- 삭제 여부의 판단은 잠금을 쥔 뒤의 두 번째 읽기가 한다. 첫 읽기와 두 번째 읽기 사이에
-- 행이 사라졌으면 `RECORD_NOT_FOUND` 로 끝난다 — 이것이 "판단과 쓰기는 같은 잠금 아래"의
-- 구체적 형태다.
--
-- 잠금 순서는 다른 경로와 동일하게 **machine → machine|date|shift → 행 잠금**이다.
-- 모든 경로가 같은 순서라야 데드락이 없다.
--
-- 시그니처는 그대로다(`p_record_id uuid`). `create or replace` 가 오버로드를 만들지 않으므로
-- 구버전 DROP 도, 마이그레이션과 코드 배포 사이의 "함수 없음" 창도 생기지 않는다.

create or replace function public.delete_production_record(p_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_key   public.production_records%rowtype;
  v_row   public.production_records%rowtype;
begin
  -- 1단계 — 잠금 키를 얻기 위한 읽기. 이 값으로 **판단하지 않는다**.
  select * into v_key
  from public.production_records
  where record_id = p_record_id;

  if not found then
    raise exception 'RECORD_NOT_FOUND';
  end if;

  -- 2단계 — 마감·불량확정·andon 과 동일한 키를 동일한 순서로 잡는다.
  -- shift 는 NULL 을 허용하는 컬럼이다. NULL 이 섞이면 `||` 결과가 NULL 이 되고
  -- `pg_advisory_xact_lock(NULL)` 은 **잠그지 않은 채 조용히 지나간다** — coalesce 로 막는다.
  perform pg_advisory_xact_lock(hashtextextended(v_key.machine_id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_key.machine_id::text || v_key.date::text || coalesce(v_key.shift, ''),
      0
    )
  );

  -- 3단계 — 잠금을 쥔 상태에서 다시 읽는다. 여기서 본 것만이 사실이다.
  select * into v_row
  from public.production_records
  where record_id = p_record_id
  for update;

  if not found then
    raise exception 'RECORD_NOT_FOUND';
  end if;

  delete from public.production_records
  where record_id = p_record_id;

  insert into public.production_shift_states (
    machine_id, date, shift, status
  ) values (
    v_row.machine_id, v_row.date, v_row.shift, 'MISSING'
  )
  on conflict (machine_id, date, shift) do update set
    status = 'MISSING',
    updated_at = clock_timestamp(),
    version = public.production_shift_states.version + 1;

  return jsonb_build_object(
    'record_id', v_row.record_id,
    'machine_id', v_row.machine_id,
    'date', v_row.date,
    'shift', v_row.shift,
    'output_qty', v_row.output_qty,
    'deleted_downtime_entries', 0,
    'shift_status', 'MISSING'
  );
end;
$$;

-- Supabase 는 `create or replace` 로 갱신된 함수에도 PUBLIC EXECUTE 를 되돌려 부여한다.
-- 이 함수는 서비스 롤(API 라우트)만 부르므로 전수로 회수한다.
revoke all on function public.delete_production_record(uuid) from public;
revoke all on function public.delete_production_record(uuid) from anon;
revoke all on function public.delete_production_record(uuid) from authenticated;
