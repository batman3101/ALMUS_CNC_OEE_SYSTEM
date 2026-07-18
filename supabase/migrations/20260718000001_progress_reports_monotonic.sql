-- 진행 보고(production_progress_reports)는 "이 교대 누적 생산량"이라 줄어들 수 없다.
-- POST 의 앱 레벨 사전검사(마지막 값 조회 → insert)는 동시 요청에 안전하지 않다:
-- 두 요청이 같은 이전 값을 읽으면 150 저장 후 60 저장 같은 역행이 통과한다(TOCTOU).
-- 이를 DB 레벨에서 원자적으로 막는다.
--
-- 주의: 단순 BEFORE INSERT 트리거의 SELECT max 는 READ COMMITTED 에서 잠금을 걸지 않아
-- 앱 레벨과 동일한 경쟁이 반복된다. 같은 (machine_id, date, shift) 삽입을 advisory lock 으로
-- 직렬화해야 "조회 후 삽입"이 실제로 원자적이 된다. 락은 트랜잭션 커밋 시 해제된다.

create or replace function public.enforce_progress_monotonic()
returns trigger
language plpgsql
as $$
declare
  prev integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.machine_id::text || new.date::text || new.shift, 0)
  );

  select max(shift_output_qty) into prev
  from public.production_progress_reports
  where machine_id = new.machine_id
    and date = new.date
    and shift = new.shift;

  if prev is not null and new.shift_output_qty < prev then
    raise exception 'shift_output_qty decreased (prev=%, new=%)', prev, new.shift_output_qty
      using errcode = 'check_violation'; -- SQLSTATE 23514 → API 가 409 로 매핑
  end if;

  return new;
end;
$$;

drop trigger if exists progress_reports_monotonic on public.production_progress_reports;

create trigger progress_reports_monotonic
  before insert on public.production_progress_reports
  for each row execute function public.enforce_progress_monotonic();
