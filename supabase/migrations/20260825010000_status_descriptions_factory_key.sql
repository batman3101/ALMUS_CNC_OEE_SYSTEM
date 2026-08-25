-- machine_status_descriptions 의 키를 공장 범위로 바꾼다
--
-- ## 무엇이 깨져 있었나 (2026-08-25 ALV 구성 중 발견)
--
-- ALT 의 상태 설명 9건을 ALV 로 복사했는데 **0건이 들어갔다.** `on conflict do nothing` 이
-- 전부 걸렀기 때문이다. 원인은 이 테이블의 PK 였다:
--
--   PRIMARY KEY (status)
--
-- `factory_id` 는 NOT NULL 인데(20260821140000) 키가 전역이다. 즉 `NORMAL_OPERATION` 행은
-- 시스템 전체에 **하나만** 존재할 수 있고, 그 하나는 backfill 이 ALT 에 줬다.
-- **ALV 는 상태 설명을 영원히 가질 수 없는 상태였다.**
--
-- 결과는 조용하다. INSERT 가 실패하지 않고 그냥 0건이 들어가며, ALV 사용자는 설비 상태
-- 라벨이 비어 있는 화면을 본다. 아무 오류도 나지 않는다.
--
-- ## 왜 원장이 못 잡았나 — 같은 형태의 다섯 번째다
--
-- `factoryScopeLedger.test.ts` 의 "전역 유일성 제약이 제거된다" 검사는 **세 개를 이름으로**
-- 확인한다:
--
--   machines_name_key / product_models_model_name_key / system_settings_setting_key_key
--
-- 그 셋은 격리 테스트가 실제로 잡아낸 것들이라 목록에 올랐다. 잡히지 않은 넷째는 목록에
-- 없었고, 그래서 없는 것이나 마찬가지였다.
--
-- 이 저장소에서 같은 형태가 반복된다: RPC 전용 Route → 뷰 → lib 경유 → 핸들러 → 이제 제약.
-- 매번 **열거가 파생보다 짧아서** 골랐고, 매번 열거 밖에서 결함이 났다.
--
-- 그래서 이번에는 그 검사를 파생으로 바꿨다 — "공장 소유 테이블의 유일 제약은 예외 없이
-- factory_id 를 포함한다". 목록을 손보지 않아도 새 테이블이 자동으로 검사 대상이 된다.
--
-- ## 뷰는 건드리지 않는다
--
-- `machine_status_statistics` 와 `recent_machine_status_changes` 가 이 테이블에 의존하지만,
-- 뷰는 **컬럼**에 의존하지 컬럼의 제약에 의존하지 않는다. PK 교체는 뷰를 무효화하지 않는다.
--
-- ## 참조하는 FK 가 없음을 확인했다
--
-- `status` 를 참조하는 외래키는 0건이다(실측). 있었다면 PK 를 바꾸기 전에 그쪽부터 옮겨야
-- 한다 — 아래 do 블록이 그 전제를 다시 확인한다.

begin;

do $$
declare
  v_fks int;
begin
  select count(*) into v_fks
  from pg_constraint
  where confrelid = 'public.machine_status_descriptions'::regclass
    and contype = 'f';

  if v_fks > 0 then
    raise exception using
      message = format('machine_status_descriptions 를 참조하는 FK 가 %s개 있다', v_fks),
      hint    = 'PK 를 바꾸면 그 FK 들이 깨진다. 참조 쪽을 (factory_id, status) 로 먼저 옮길 것.';
  end if;
end $$;

alter table public.machine_status_descriptions
  drop constraint machine_status_descriptions_pkey;

alter table public.machine_status_descriptions
  add constraint machine_status_descriptions_pkey primary key (factory_id, status);

comment on table public.machine_status_descriptions is
  '설비 상태의 표시 라벨. 공장마다 문구를 다르게 둘 수 있으므로 키가 (factory_id, status) 다.';

-- 확인 — "적용됐다"와 "그 키가 실제로 공장을 포함한다"는 다르다.
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.machine_status_descriptions'::regclass and contype = 'p';

  if v_def is null or v_def !~* 'factory_id' then
    raise exception 'PK 가 factory_id 를 포함하지 않는다: %', coalesce(v_def, '(없음)');
  end if;
  raise notice 'PASS: machine_status_descriptions PK = %', v_def;
end $$;

-- ---------------------------------------------------------------------------
-- 불변조건: 공장 소유 테이블의 유일 키는 공장 간 충돌을 일으킬 수 없다
-- ---------------------------------------------------------------------------
-- 이 결함을 이름으로 하나 고치는 것으로 끝내면, 목록 밖의 다음 테이블에서 같은 일이 난다.
-- 이 저장소에서 그 형태가 다섯 번 반복됐다. 그래서 이번에는 **파생**한다.
--
-- 규칙: 유일 키(PK/UNIQUE)는 아래 셋 중 하나를 만족해야 한다.
--   (a) 키에 `factory_id` 가 있다
--   (b) 키에 **공장 소유 부모를 가리키는 FK 컬럼**이 있다 — 부모가 이미 공장을 함의한다
--       (`production_records(machine_id, date, shift)` 가 이 경우다: 설비는 한 공장에만
--        속하므로 공장을 키에 더해도 유일성이 좁아지지 않는다. 20260821150000 주석 참조)
--   (c) 대리키다 — 기본값이나 identity 를 가진 단일 컬럼. 충돌 자체가 불가능하다.
--
-- 어느 것도 아니면 그 키는 **업무 값만으로 전역 유일**을 요구한다. `status` 가 그랬다.
--
-- 예외 둘은 의도된 것이라 이름으로 허용한다. 이름을 적어 두면 다음 사람이 "왜 여기만"을
-- 묻지 않아도 된다:
--   - `factory_domains_pkey (hostname)`: hostname 은 **전역 유일이어야 맞다.** 한 호스트가
--     두 공장으로 해석되면 그것이 곧 잘못된 공장에 쓰기다(20260821100000).
--   - `user_factory_selection_pkey (user_id)`: 사용자당 현재 공장은 하나다(20260824190000).
do $$
declare
  r record;
  v_bad int := 0;
begin
  for r in
    with factory_owned as (
      select c.oid, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'factory_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'
    ),
    fk_cols as (
      select con.conrelid, a.attname
      from pg_constraint con
      join factory_owned p on p.oid = con.confrelid
      cross join lateral unnest(con.conkey) k
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k
      where con.contype = 'f'
    ),
    keys as (
      select fo.relname as table_name, con.conname, con.conrelid,
             pg_get_constraintdef(con.oid) as def,
             array(select a.attname from unnest(con.conkey) k
                   join pg_attribute a on a.attrelid = fo.oid and a.attnum = k) as key_cols
      from factory_owned fo
      join pg_constraint con on con.conrelid = fo.oid and con.contype in ('p', 'u')
    )
    select k.table_name, k.conname, k.def
    from keys k
    where k.conname not in ('factory_domains_pkey', 'user_factory_selection_pkey')
      and not ('factory_id' = any(k.key_cols))
      and not exists (
        select 1 from fk_cols f
        where f.conrelid = k.conrelid and f.attname = any(k.key_cols)
      )
      and not (
        array_length(k.key_cols, 1) = 1
        and exists (
          select 1 from pg_attribute a
          where a.attrelid = k.conrelid and a.attname = k.key_cols[1]
            and (a.atthasdef or a.attidentity <> '')
        )
      )
    order by k.table_name, k.conname
  loop
    raise warning '공장 간 충돌 가능한 유일 키: %.% — %', r.table_name, r.conname, r.def;
    v_bad := v_bad + 1;
  end loop;

  if v_bad > 0 then
    raise exception using
      message = format('업무 값만으로 전역 유일을 요구하는 키가 %s개 있다', v_bad),
      hint    = '키에 factory_id 를 더하거나, 의도된 전역 키라면 위 예외 목록에 사유와 함께 추가할 것.';
  end if;
  raise notice 'PASS: 공장 소유 테이블의 유일 키가 모두 공장 안에서만 충돌한다';
end $$;

commit;
