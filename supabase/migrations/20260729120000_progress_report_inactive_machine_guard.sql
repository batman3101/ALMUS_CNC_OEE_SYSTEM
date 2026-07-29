-- Codex 감사(2026-07-29) HIGH #5 수정 (DB 쪽 절반): 진행 보고의 비활성 설비 가드.
--
-- 배경 — 20260720030000 이 toggle_machine_downtime 에 `machine_inactive` 가드를 넣었지만
-- report_shift_progress 는 그 정리에서 빠졌다. 그래서 관리자가 비활성화한 설비에도 진척
-- 보고가 계속 쌓였고, 그 값은 교대 마감이 output_qty 로 승격시킨다.
--
-- 왜 이 검사를 Node 가 아니라 여기에 두는가 —
--   설비 활성 여부는 **관리자의 비활성화와 정면으로 경쟁하는** 판단이다. 라우트에서 먼저
--   조회하면 그 조회는 트랜잭션 밖이라 조회와 INSERT 사이가 비어 있다. CLAUDE.md 의
--   "판단과 쓰기는 같은 잠금 아래" 규약이 정확히 이 경우를 위한 것이다.
--   (반대로 교대 시간창 판단은 경쟁 상대가 없어 라우트 층에 둔다 — 같은 감사의 앱 쪽 절반)
--
-- 왜 `for update` 를 함께 쓰는가 —
--   20260729060000 이 세운 규약: advisory lock 은 Postgres 에서 독립된 네임스페이스라
--   `SELECT ... FOR UPDATE` 와 서로를 차단하지 않는다. RPC 를 거치지 않고 machines 를 직접
--   UPDATE 하는 경로(관리자 설비 비활성화: api/machines DELETE, api/machines/[machineId]
--   PATCH)와 상호 배제하려면 **행 잠금**이 필요하다. 순서는 항상 advisory → 행 잠금.
--
-- 시그니처는 바꾸지 않는다 —
--   CLAUDE.md 경고대로 인자를 늘리면 `create or replace` 가 오버로드를 만들고, 옛 함수를
--   DROP 하면 마이그레이션과 코드 배포 사이에 어느 순서로도 피할 수 없는 "함수 없음" 창이
--   생긴다. 이 가드는 인자가 필요 없으므로 본문만 교체한다. 따라서 **이 마이그레이션이
--   코드 배포보다 먼저 적용돼도 안전하다** (비활성 설비 보고가 먼저 막힐 뿐이다).

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
