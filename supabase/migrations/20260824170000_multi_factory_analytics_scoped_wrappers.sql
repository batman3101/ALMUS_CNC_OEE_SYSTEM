-- 분석 RPC 를 공장 범위로 — 집계 로직은 복사하지 않고 감싼다
--
-- ## 무엇이 새고 있었나
--
-- 분석 라우트들은 `requireFactoryUser` 로 전환됐지만, 정작 숫자를 만드는 RPC 에는 공장을
-- 넘기지 않았다:
--
--   analytics_productivity(p_start_date, p_end_date, p_machine_ids => null, p_shifts)
--                                                                    ^^^^ "전체 설비"
--
-- 화면에서 설비를 고르지 않았을 때가 기본값이고, 그때 `null` 은 **모든 공장의 모든 설비**를
-- 뜻한다. ALV 관리자 화면에 ALT 800대가 섞인 평균이 뜬다.
--
-- 이 누수는 `.eq('factory_id', ...)` 를 세는 검사로는 잡히지 않았다. 같은 파일 어딘가에 그
-- 필터가 하나라도 있으면 "전환됨"으로 세어졌기 때문이다. 존재를 세면 전수를 놓친다.
--
-- ## 왜 본문을 복사하지 않는가
--
-- `analytics_productivity` 의 CTE 는 전부 MATERIALIZED 이고, 그것은 장식이 아니라 성능
-- 결정이다 — 떼면 800대 기준 184ms 가 6,360ms 가 된다(20260717000000). `analytics_quality`
-- 에는 임계값 인자가 있고, `analytics_oee_by_machine` 은 TABLE 을 돌려준다.
--
-- 이 본문들을 공장별로 한 벌씩 더 두면, 다음에 누가 한쪽만 고친다. 그 순간 두 함수가 서로
-- 다른 답을 내고, 차이는 "어느 화면에서 봤는가"로만 드러난다 — 재현하기 가장 어려운 종류의
-- 불일치다.
--
-- 그래서 **얇은 래퍼**만 만든다. 래퍼가 하는 일은 하나뿐이다: 설비 목록을 이 공장 것으로
-- 좁혀서 원본에 넘긴다.
--
-- ## 빈 배열과 NULL 은 다르다
--
--   p_machine_ids = NULL  -> 원본 함수는 "설비 조건 없음" = 전 공장
--   p_machine_ids = '{}'  -> `id = any('{}')` 는 항상 거짓 = 결과 없음
--
-- 그래서 래퍼는 **절대 NULL 을 넘기지 않는다.** 설비가 하나도 없는 공장은 빈 배열을 받아
-- 빈 결과를 낸다. 이것이 옳다 — "설비가 없으니 실적도 없다"이지 "필터가 없으니 전부"가
-- 아니다. `coalesce(array_agg(...), '{}')` 의 `'{}'` 가 그 역할을 한다.
--
-- ## 호출자가 설비를 지정한 경우
--
-- 요청이 준 id 목록을 그대로 믿지 않고 **교집합**을 취한다. 남의 공장 설비 id 를 섞어 보내도
-- 그 id 는 목록에서 빠진다. 요청이 전달한 값은 권위가 없다(계약 절대조건 4번).

begin;

/**
 * 이 공장의 설비 id. 호출자가 목록을 줬으면 그 교집합.
 *
 * 별도 함수로 두는 이유는 아래 래퍼 셋이 같은 규칙을 써야 하기 때문이다. 세 곳에 같은
 * 서브쿼리를 적으면 언젠가 하나만 고쳐진다.
 */
create or replace function public.factory_machine_ids(
  p_factory_id uuid,
  p_requested uuid[] default null
)
returns uuid[]
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(m.id), '{}'::uuid[])
  from public.machines m
  where m.factory_id = p_factory_id
    and (p_requested is null or m.id = any(p_requested));
$$;

create or replace function public.analytics_productivity_scoped(
  p_factory_id uuid,
  p_start_date date,
  p_end_date date,
  p_machine_ids uuid[] default null,
  p_shifts text[] default null
)
returns json
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select public.analytics_productivity(
    p_start_date,
    p_end_date,
    public.factory_machine_ids(p_factory_id, p_machine_ids),
    p_shifts
  );
$$;

create or replace function public.analytics_quality_scoped(
  p_factory_id uuid,
  p_start_date date,
  p_end_date date,
  p_machine_ids uuid[] default null,
  p_shifts text[] default null,
  p_quality_threshold float8 default 95
)
returns json
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select public.analytics_quality(
    p_start_date,
    p_end_date,
    public.factory_machine_ids(p_factory_id, p_machine_ids),
    p_shifts,
    p_quality_threshold
  );
$$;

create or replace function public.analytics_oee_by_machine_scoped(
  p_factory_id uuid,
  p_start_date date,
  p_end_date date default null,
  p_machine_ids uuid[] default null,
  p_shifts text[] default null
)
-- ⚠️ 이 컬럼 목록은 원본과 **글자 그대로** 같아야 한다. 실제로 처음 적용할 때 여기서
-- 걸렸다("Final statement returns too many columns") — 원본이 그동안 3개 늘어나 있었고,
-- 옛 마이그레이션 파일만 읽고 베낀 목록은 이미 낡아 있었다.
-- 아래 do 블록이 이 결합을 감시한다.
returns table(
  machine_id uuid,
  total_records bigint,
  avg_availability double precision,
  avg_performance double precision,
  avg_quality double precision,
  avg_oee double precision,
  total_output bigint,
  total_defect bigint,
  unreported_records bigint,
  reported_records bigint,
  impossible_records bigint
)
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select *
  from public.analytics_oee_by_machine(
    p_start_date,
    p_end_date,
    public.factory_machine_ids(p_factory_id, p_machine_ids),
    p_shifts
  );
$$;

/**
 * 요약 통계는 래퍼로 감쌀 수 없다 — 원본이 설비를 **단건**(`p_machine_id uuid`)으로만
 * 받아서 "이 공장의 설비들"을 표현할 방법이 없다. 그래서 이 하나만 본문을 다시 쓴다.
 *
 * 본문은 원본(20260713202705)과 글자 그대로 같고, `factory_id` 조건 두 줄만 더해졌다.
 */
create or replace function public.analytics_oee_records_summary_scoped(
  p_factory_id uuid,
  p_start_date date,
  p_end_date   date default null,
  p_machine_id uuid default null,
  p_shift      text default null
)
returns table (
  total_records    bigint,
  avg_availability float8,
  avg_performance  float8,
  avg_quality      float8,
  avg_oee          float8
)
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select
    count(*)::bigint                                                as total_records,
    coalesce(avg(coalesce(pr.availability, 0)::float8), 0::float8)  as avg_availability,
    coalesce(avg(coalesce(pr.performance,  0)::float8), 0::float8)  as avg_performance,
    coalesce(avg(coalesce(pr.quality,      0)::float8), 0::float8)  as avg_quality,
    coalesce(avg(coalesce(pr.oee,          0)::float8), 0::float8)  as avg_oee
  from production_records pr
  where pr.date >= p_start_date
    and pr.factory_id = p_factory_id
    and (p_end_date   is null or pr.date       <= p_end_date)
    and (p_machine_id is null or pr.machine_id  = p_machine_id)
    and (p_shift      is null or pr.shift       = p_shift)
    and exists (
      select 1 from machines m
      where m.id = pr.machine_id and m.factory_id = p_factory_id
    );
$$;

/**
 * 래퍼와 원본의 반환 시그니처가 갈라지지 않았는지 확인한다.
 *
 * 래퍼는 원본의 컬럼 목록을 손으로 베낀다 — SQL 에는 "저 함수의 반환형과 같게"라고 쓸
 * 방법이 없다. 그래서 원본에 컬럼이 하나 늘면 래퍼는 조용히 낡는다. 조용히는 아니고
 * 함수 생성 자체가 실패하지만, 그것은 **이 파일을 처음 적용할 때뿐**이다. 이미 적용된
 * 환경에서 나중에 원본만 바뀌면 아무도 모른다.
 *
 * 이 검사는 그 순간을 잡지 못한다(마이그레이션은 한 번만 돈다). 대신 새 환경을 세울
 * 때마다 — 로컬 재구축, 스테이징, 재해 복구 — 다시 돈다. 그때 어긋나 있으면 배포가
 * 아니라 환경 구축 단계에서 멈춘다.
 */
do $$
declare
  v_original text;
  v_wrapper  text;
begin
  select pg_get_function_result(oid) into v_original
  from pg_proc where proname = 'analytics_oee_by_machine';

  select pg_get_function_result(oid) into v_wrapper
  from pg_proc where proname = 'analytics_oee_by_machine_scoped';

  if v_original is distinct from v_wrapper then
    raise exception using
      message = 'analytics_oee_by_machine_scoped 의 반환형이 원본과 다릅니다',
      detail  = format('원본: %s / 래퍼: %s', v_original, v_wrapper),
      hint    = '원본에 컬럼이 추가되었다면 래퍼의 returns table(...) 도 같이 고쳐야 합니다.';
  end if;
end $$;

-- 권한은 열거하지 말고 전수 회수 후 필요한 곳에만 다시 준다 — Supabase 는 새 함수에
-- PUBLIC EXECUTE 를 되돌려 부여하는 경우가 있다(2026-07-29 실측).
revoke all on function public.factory_machine_ids(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.analytics_productivity_scoped(uuid, date, date, uuid[], text[]) from public, anon, authenticated;
revoke all on function public.analytics_quality_scoped(uuid, date, date, uuid[], text[], float8) from public, anon, authenticated;
revoke all on function public.analytics_oee_by_machine_scoped(uuid, date, date, uuid[], text[]) from public, anon, authenticated;
revoke all on function public.analytics_oee_records_summary_scoped(uuid, date, date, uuid, text) from public, anon, authenticated;

grant execute on function public.factory_machine_ids(uuid, uuid[]) to service_role;
grant execute on function public.analytics_productivity_scoped(uuid, date, date, uuid[], text[]) to service_role;
grant execute on function public.analytics_quality_scoped(uuid, date, date, uuid[], text[], float8) to service_role;
grant execute on function public.analytics_oee_by_machine_scoped(uuid, date, date, uuid[], text[]) to service_role;
grant execute on function public.analytics_oee_records_summary_scoped(uuid, date, date, uuid, text) to service_role;

commit;
