-- audit_log 의 factory_id 를 **감사 대상 행에서** 유도한다
--
-- ## 20260824210000 의 주석이 틀렸다
--
-- 그 파일은 audit_log 를 이렇게 미뤄 뒀다:
--
--   "유일한 쓰기 경로인 `audit_role_change` 는 역할 변경을 기록하는데 …
--    그 감사 기록이 어느 공장에 속하는지는 운영 결정이 필요하므로 비워 두고 별도로 정한다"
--
-- 두 군데가 사실과 다르다:
--
--   1. **`audit_role_change` 라는 함수는 존재하지 않는다.** 마이그레이션 전체를 훑어
--      각 함수의 최종 정의를 모아 확인했다.
--   2. 실제 쓰기 경로는 **두 개**이고 둘 다 운영 중인 기능이다:
--
--      | 함수 | 화면 기능 | 기록 조건 |
--      |---|---|---|
--      | `correct_open_downtime_reason` | 비가동 사유 정정 | **무조건** |
--      | `close_shift_upsert_v3`        | 교대 마감       | 마감 수량 < 마지막 진척 |
--
-- 즉 20260821140000 이 `audit_log.factory_id` 를 NOT NULL 로 만든 순간부터
-- **비가동 사유 정정은 100% 실패하고, 하향 마감은 트랜잭션째 롤백되어 마감 자체가 막힌다.**
-- 없는 함수를 근거로 예외 처리한 탓에 두 실제 경로를 놓쳤다.
--
-- 2026-08-24 브라우저 검증이 이것을 못 잡은 이유는 그 두 경로를 밟지 않았기 때문이다.
-- 20260824210000 의 자체 확인 블록도 `production_records` 한 테이블만 넣어 봤다.
--
-- ## 왜 함수 본문을 고치지 않고 트리거를 다는가
--
-- 두 함수는 각각 100줄이 넘는다. 본문을 복사해 한 줄을 끼워 넣는 방식은 이번 작업에서
-- 이미 사고를 냈다 — `analytics_oee_records_summary_scoped` 에 낡은 5컬럼 본문을 베껴
-- 리포트 화면이 "계산 가능 0건인데 평균 OEE 49%"라는 자기모순을 표시했다(20260824200000).
--
-- 트리거는 그 위험이 없다. 원본 함수를 건드리지 않으므로 드리프트가 생길 여지가 없고,
-- 20260824210000 이 이미 같은 판단을 한 선례가 있다(12개 함수 대신 유도 트리거).
--
-- ## 다형 참조를 어떻게 푸는가 — 짐작이 아니다
--
-- `audit_log(table_name, record_id)` 는 다형 참조라 **정적으로는** 부모를 모른다. 그러나
-- 실제로 쓰이는 조합은 두 가지뿐이고, 각각은 모호하지 않다:
--
--   ('machines',            record_id) -> machines.id            -> factory_id
--   ('production_records',  record_id) -> production_records.record_id -> factory_id
--
-- 둘 다 PK 조회다. `record_id` 는 `uuid not null` 이고 두 부모의 `factory_id` 는 NOT NULL
-- 이므로, 결과는 추측이 아니라 **조회**다. 20260824210000 과 같은 성질이다.
--
-- ## 모르는 대상은 조용히 넘기지 않는다
--
-- 목록에 없는 `table_name` 은 예외를 던진다. 그냥 두면 NOT NULL 이 어차피 막지만,
-- 그때 나오는 메시지는 "factory_id 가 null 입니다"뿐이라 **무엇을 해야 하는지 알려주지
-- 않는다.** 여기서 막으면 테이블 이름과 조치가 함께 찍힌다.
--
-- 즉 이 트리거는 편의인 동시에 **원장**이다. 새 감사 경로가 생기면 조용히 통과하지 않고
-- 여기서 이름이 찍힌 채 멈춘다.

begin;

create or replace function public.derive_factory_from_audit_target()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 명시적으로 준 값은 건드리지 않는다. 부모와 어긋나면 복합 FK 가 아니라 아래 검사가
  -- 잡는다 — audit_log 는 다형 참조라 복합 FK 를 걸 수 없기 때문이다.
  if new.factory_id is not null then
    return new;
  end if;

  case new.table_name
    when 'machines' then
      select m.factory_id into new.factory_id
      from public.machines m
      where m.id = new.record_id;

    when 'production_records' then
      select pr.factory_id into new.factory_id
      from public.production_records pr
      where pr.record_id = new.record_id;

    else
      raise exception using
        message = format('audit_log 에 처음 보는 감사 대상이 들어왔다: table_name=%L',
                         new.table_name),
        detail  = 'factory_id 를 유도할 방법이 정의되어 있지 않다.',
        hint    = 'derive_factory_from_audit_target() 에 이 table_name 의 부모 조회를 '
                  '추가하거나, 호출부가 factory_id 를 직접 넣어야 합니다.',
        errcode = '23502';
  end case;

  -- 부모를 못 찾은 경우. NOT NULL 이 어차피 막지만, 여기서 막아야 "어느 행을 못 찾았는지"가
  -- 남는다. 삭제된 행을 감사하려는 상황이 대표적이다.
  if new.factory_id is null then
    raise exception using
      message = format('감사 대상 행을 찾을 수 없어 공장을 유도하지 못했다: %s(%s)',
                       new.table_name, new.record_id),
      errcode = '23502';
  end if;

  return new;
end $$;

comment on function public.derive_factory_from_audit_target() is
  'audit_log 의 factory_id 를 (table_name, record_id) 가 가리키는 행에서 유도한다. '
  '모르는 table_name 은 거부한다 — 조용히 통과시키면 감사 기록이 공장 밖으로 샌다.';

-- BEFORE INSERT 여야 한다. AFTER 면 NOT NULL 검사가 먼저 돌아 이미 실패한 뒤다.
drop trigger if exists trg_audit_log_derive_factory on public.audit_log;
create trigger trg_audit_log_derive_factory
  before insert on public.audit_log
  for each row execute function public.derive_factory_from_audit_target();

revoke all on function public.derive_factory_from_audit_target() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 자체 확인 — "적용됐다"와 "동작한다"는 다르다
-- ---------------------------------------------------------------------------
-- 20260824210000 의 확인 블록은 `production_records` 하나만 넣어 봤고, 그래서 audit_log 가
-- 통째로 빠진 것을 못 봤다. 여기서는 **실제로 쓰이는 두 조합을 모두** 넣어 본다.
do $$
declare
  v_machine  uuid;
  v_mfactory uuid;
  v_record   uuid;
  v_rfactory uuid;
  v_id       uuid;
  v_got      uuid;
  v_raised   boolean := false;
begin
  select id, factory_id into v_machine, v_mfactory from public.machines limit 1;
  select record_id, factory_id into v_record, v_rfactory from public.production_records limit 1;

  -- 1) table_name = 'machines'
  if v_machine is not null then
    insert into public.audit_log (table_name, record_id, action)
    values ('machines', v_machine, 'derive_test')
    returning id, factory_id into v_id, v_got;

    if v_got is distinct from v_mfactory then
      raise exception 'machines 감사 유도 실패: 기대 % / 실제 %', v_mfactory, v_got;
    end if;
    delete from public.audit_log where id = v_id;
    raise notice 'PASS: machines 감사 기록이 설비에서 공장을 유도한다';
  else
    raise notice 'SKIP: 설비가 없어 machines 경로를 확인할 수 없다';
  end if;

  -- 2) table_name = 'production_records'
  if v_record is not null then
    insert into public.audit_log (table_name, record_id, action)
    values ('production_records', v_record, 'derive_test')
    returning id, factory_id into v_id, v_got;

    if v_got is distinct from v_rfactory then
      raise exception 'production_records 감사 유도 실패: 기대 % / 실제 %', v_rfactory, v_got;
    end if;
    delete from public.audit_log where id = v_id;
    raise notice 'PASS: production_records 감사 기록이 생산기록에서 공장을 유도한다';
  else
    raise notice 'SKIP: 생산기록이 없어 production_records 경로를 확인할 수 없다';
  end if;

  -- 3) 모르는 대상은 거부되어야 한다. 이것이 통과하면 트리거는 "있지만 아무것도 안 하는"
  --    상태다 — 20260824210000 의 주석이 경고한 바로 그 실패 형태다.
  begin
    insert into public.audit_log (table_name, record_id, action)
    values ('user_profiles', gen_random_uuid(), 'derive_test');
    raise notice 'FAIL: 모르는 감사 대상이 통과했다';
  exception when not_null_violation then
    v_raised := true;
  end;

  if not v_raised then
    raise exception '모르는 table_name 이 거부되지 않았다 — 트리거가 동작하지 않는다';
  end if;
  raise notice 'PASS: 모르는 감사 대상은 이름이 찍힌 채 거부된다';
end $$;

commit;
