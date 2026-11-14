-- Forecast 실제 PO 수정 (사용자 요청 2026-09-29).
--
-- 접수한 Forecast 는 고객의 계획이라 실제 PO 와 어긋날 수 있다(특히 개발 모델). 그래서 접수된 Forecast 의
-- 날짜별 수량을 '실제 PO 수량'으로 고쳐 두고, 시뮬레이션이 그 값을 쓰게 한다. 원본 Forecast 값은 그대로 둔다.
--
-- 사용자 결정 (2026-09-29)
--   · 새 Forecast 를 '접수 확정'하면 PO 수정값은 초기화한다(새 파일이 기준). 그래서 수정값은 '접수 1건'에 속한다:
--     forecast_submissions.submission_id 는 접수를 확정(= 그 행의 UPDATE)할 때마다 DB 가 새 uuid 로 바꾸고,
--     그 번호가 다른 수정값은 화면·시뮬레이션이 쓰지 않는다. 옛 수정값 행은 지우지 않는다 — 이력이다.
--     앱 코드가 아니라 트리거가 번호를 바꾸므로, 접수 저장 코드가 바뀌어도 '접수 = 초기화'는 깨지지 않는다.
--   · 변경 이력은 전부 보관한다: 적용·원복마다 '누가·언제·몇 → 몇'을 추가 전용 표(forecast_po_override_events)에 쌓는다.
--     원복해도 이력은 남는다.
--
-- 구성
--   forecast_po_overrides         지금 적용 중인 수정값. (공장, 접수, 원본 행, 날짜)당 1행.
--   forecast_po_override_events   적용·원복 이력. UPDATE/DELETE 를 막는다(추가 전용).
--   apply_forecast_po_override    수정값 적용: 표 갱신 + 이력 추가가 한 트랜잭션. 접수가 그사이 바뀌었으면 거부.
--   revert_forecast_po_override   수정값 원복(Forecast 원본 값으로 되돌림): 행 삭제 + 이력 추가.
--
-- ⚠ 설비 배치·T/T 는 여기에 저장하지 않는다(forecast_submissions 와 같은 원칙). 수정값은 수량뿐이다.
--
-- 읽기·쓰기 모두 서비스 롤 라우트(/api/forecasts/po-overrides, /api/forecasts/submission)만 한다. 인가(관리자·엔지니어)는
-- 라우트가 하고, 함수는 p_factory_id 로 모든 문장을 공장 범위에 묶는다. RLS 는 켜고 정책은 만들지 않는다 —
-- authenticated 는 행이 보이지 않는다.
--
-- 오류 규약 (라우트가 메시지로 구분해 상태 코드로 바꾼다)
--   SUBMISSION_CHANGED   55000  접수가 그사이 바뀌었다(다른 사람이 새 Forecast 를 접수) → 새로 읽고 다시.
--   INVALID_PO_QUANTITY  22023  0 이상 1억 이하의 정수가 아니다.

begin;

-- ── 접수마다 고유 번호 ───────────────────────────────────────────────────────────────────────
-- 기존 접수 행은 기본값으로 채워진다(운영에는 공장당 최대 1행).
alter table public.forecast_submissions
  add column if not exists submission_id uuid not null default gen_random_uuid();

create or replace function public.renew_forecast_submission_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- forecast_submissions 는 접수 확정(upsert 의 UPDATE)으로만 바뀐다. 바뀔 때마다 새 번호 = PO 수정값 초기화.
  new.submission_id := gen_random_uuid();
  return new;
end;
$$;
revoke all on function public.renew_forecast_submission_id() from public, anon, authenticated;
create trigger trg_forecast_submissions_renew_id
  before update on public.forecast_submissions
  for each row execute function public.renew_forecast_submission_id();

-- ── 현재 수정값 ─────────────────────────────────────────────────────────────────────────────
create table public.forecast_po_overrides (
  factory_id uuid not null references public.factories(id),
  -- forecast_submissions.submission_id. FK 를 걸지 않는다: 접수 행은 UPDATE 로 번호가 바뀌는데,
  -- 그때 수정값이 따라 바뀌거나 막히면 '초기화'가 아니게 된다.
  submission_id uuid not null,
  -- 접수된 파일의 Excel 행 번호(원본 행). 같은 접수 안에서는 행마다 유일하다.
  source_row integer not null check (source_row > 0),
  work_date date not null,
  model text not null check (model <> ''),
  quantity integer not null check (quantity between 0 and 100000000),
  -- 수정 당시의 Forecast 원본 값(숫자가 아니었으면 null)과 그 상태.
  forecast_quantity numeric,
  forecast_state text not null check (forecast_state in ('number', 'blank', 'error', 'missing_cache', 'invalid')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (factory_id, submission_id, source_row, work_date)
);
comment on table public.forecast_po_overrides is
  '접수한 Forecast 의 날짜별 실제 PO 수량. 접수 1건(submission_id)에 속하며, 새 접수가 오면 쓰이지 않는다.';

-- ── 변경 이력 (추가 전용) ───────────────────────────────────────────────────────────────────
create table public.forecast_po_override_events (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id),
  submission_id uuid not null,
  source_row integer not null,
  work_date date not null,
  model text not null,
  action text not null check (action in ('apply', 'revert')),
  -- 그 직전에 적용돼 있던 PO 수정값(없었으면 null)과 이후 값(원복이면 null).
  quantity_before integer,
  quantity_after integer,
  forecast_quantity numeric,
  forecast_state text not null,
  actor uuid,
  occurred_at timestamptz not null default now(),
  constraint forecast_po_override_events_shape check (
    (action = 'apply' and quantity_after is not null)
    or (action = 'revert' and quantity_after is null and quantity_before is not null)
  )
);
create index forecast_po_override_events_lookup
  on public.forecast_po_override_events (factory_id, work_date, occurred_at desc);
comment on table public.forecast_po_override_events is
  'PO 수정 적용·원복 이력. 누가·언제·몇 → 몇. 추가 전용(UPDATE/DELETE 불가).';

create or replace function public.forbid_forecast_po_event_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'forecast_po_override_events is append-only' using errcode = '55000';
end;
$$;
revoke all on function public.forbid_forecast_po_event_change() from public, anon, authenticated;
create trigger trg_forecast_po_override_events_append_only
  before update or delete on public.forecast_po_override_events
  for each row execute function public.forbid_forecast_po_event_change();

-- ── 권한 ─────────────────────────────────────────────────────────────────────────────────────
alter table public.forecast_po_overrides enable row level security;
alter table public.forecast_po_override_events enable row level security;
revoke all on public.forecast_po_overrides, public.forecast_po_override_events from public, anon, authenticated;
-- 없으면 서비스 롤 라우트가 42501 로 깨진다.
grant all on public.forecast_po_overrides, public.forecast_po_override_events to service_role;

-- ── 적용 ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.apply_forecast_po_override(
  p_factory_id uuid,
  p_submission_id uuid,
  p_actor uuid,
  p_source_row integer,
  p_work_date date,
  p_model text,
  p_quantity integer,
  p_forecast_quantity numeric,
  p_forecast_state text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before integer;
  v_at timestamptz;
begin
  if p_factory_id is null or p_submission_id is null then
    raise exception 'p_factory_id and p_submission_id are required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 100000000 then
    raise exception 'INVALID_PO_QUANTITY' using errcode = '22023';
  end if;

  -- 접수가 그사이 바뀌었으면 거부한다. FOR SHARE 는 이 쓰기가 끝날 때까지 접수 교체(UPDATE)를 막는다 —
  -- 새 접수가 들어온 뒤에 옛 접수의 수정값이 쓰이는 일이 없다.
  perform 1 from public.forecast_submissions
   where factory_id = p_factory_id and submission_id = p_submission_id
     for share;
  if not found then
    raise exception 'SUBMISSION_CHANGED' using errcode = '55000';
  end if;

  select quantity, updated_at into v_before, v_at from public.forecast_po_overrides
   where factory_id = p_factory_id and submission_id = p_submission_id
     and source_row = p_source_row and work_date = p_work_date
     for update;

  -- 같은 값을 다시 적용하는 것은 변경이 아니다: 표도 이력도 건드리지 않는다(기존 수정 시각만 돌려준다).
  if v_before is not null and v_before = p_quantity then
    return jsonb_build_object('quantity', p_quantity, 'previous', v_before, 'unchanged', true, 'updated_at', v_at);
  end if;

  insert into public.forecast_po_overrides
    (factory_id, submission_id, source_row, work_date, model, quantity, forecast_quantity, forecast_state, updated_by, updated_at)
  values
    (p_factory_id, p_submission_id, p_source_row, p_work_date, p_model, p_quantity, p_forecast_quantity, p_forecast_state, p_actor, now())
  on conflict (factory_id, submission_id, source_row, work_date) do update
    set model = excluded.model, quantity = excluded.quantity,
        forecast_quantity = excluded.forecast_quantity, forecast_state = excluded.forecast_state,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning updated_at into v_at;

  insert into public.forecast_po_override_events
    (factory_id, submission_id, source_row, work_date, model, action, quantity_before, quantity_after,
     forecast_quantity, forecast_state, actor, occurred_at)
  values
    (p_factory_id, p_submission_id, p_source_row, p_work_date, p_model, 'apply', v_before, p_quantity,
     p_forecast_quantity, p_forecast_state, p_actor, v_at);

  return jsonb_build_object('quantity', p_quantity, 'previous', v_before, 'unchanged', false, 'updated_at', v_at);
end;
$$;

-- ── 원복 ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.revert_forecast_po_override(
  p_factory_id uuid,
  p_submission_id uuid,
  p_actor uuid,
  p_source_row integer,
  p_work_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.forecast_po_overrides%rowtype;
begin
  if p_factory_id is null or p_submission_id is null then
    raise exception 'p_factory_id and p_submission_id are required' using errcode = '22023';
  end if;

  perform 1 from public.forecast_submissions
   where factory_id = p_factory_id and submission_id = p_submission_id
     for share;
  if not found then
    raise exception 'SUBMISSION_CHANGED' using errcode = '55000';
  end if;

  delete from public.forecast_po_overrides
   where factory_id = p_factory_id and submission_id = p_submission_id
     and source_row = p_source_row and work_date = p_work_date
  returning * into v_old;

  -- 되돌릴 수정값이 없으면 할 일이 없다(이미 원복됐거나 처음부터 없었다).
  if not found then
    return jsonb_build_object('reverted', false);
  end if;

  insert into public.forecast_po_override_events
    (factory_id, submission_id, source_row, work_date, model, action, quantity_before, quantity_after,
     forecast_quantity, forecast_state, actor)
  values
    (p_factory_id, p_submission_id, p_source_row, p_work_date, v_old.model, 'revert', v_old.quantity, null,
     v_old.forecast_quantity, v_old.forecast_state, p_actor);

  return jsonb_build_object('reverted', true, 'previous', v_old.quantity);
end;
$$;

-- 함수 실행 권한: 새 함수에는 Supabase 가 PUBLIC EXECUTE 를 되돌려 부여한다 — 전수 회수 뒤 서비스 롤에만 준다.
revoke all on function public.apply_forecast_po_override(uuid, uuid, uuid, integer, date, text, integer, numeric, text)
  from public, anon, authenticated;
grant execute on function public.apply_forecast_po_override(uuid, uuid, uuid, integer, date, text, integer, numeric, text)
  to service_role;
revoke all on function public.revert_forecast_po_override(uuid, uuid, uuid, integer, date)
  from public, anon, authenticated;
grant execute on function public.revert_forecast_po_override(uuid, uuid, uuid, integer, date)
  to service_role;

commit;
