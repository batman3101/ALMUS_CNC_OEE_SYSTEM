-- 설정 쓰기 RPC 를 공장 범위로
--
-- ## 무엇이 깨져 있었나
--
-- `update_system_setting(p_category, p_key, ...)` 은 공장을 모른다:
--
--   SELECT id, setting_value INTO v_setting_id, v_old_value
--   FROM system_settings
--   WHERE category = p_category AND setting_key = p_key;
--
-- 유일성이 `(factory_id, category, setting_key)` 로 바뀐 뒤(20260821110000) 이 WHERE 는
-- **두 공장의 행을 모두** 고른다. plpgsql 의 `SELECT ... INTO` 는 여러 행이 와도 오류를
-- 내지 않고 **첫 행**을 집는다 — 어느 공장 행인지는 계획에 달렸고 보장이 없다. ALV 관리자가
-- 교대 시작시각을 바꾸면 ALT 의 행이 바뀔 수 있다.
--
-- 실제로는 그 앞에서 터진다. `system_settings_audit.factory_id` 가 NOT NULL 이 되었는데
-- (20260821140000) INSERT 가 그 컬럼을 채우지 않기 때문이다. 즉 지금 상태는 "조용한 오염"이
-- 아니라 **설정 저장 전면 실패**다. 둘 다 고친다.
--
-- ## 왜 인자를 늘리지 않고 새 이름인가
--
-- CLAUDE.md: `create or replace` 는 인자 목록이 다르면 덮어쓰지 않고 **오버로드**를 만든다.
-- 그래서 인자를 늘리려면 옛 함수를 DROP 해야 하고, DROP 하는 순간 마이그레이션과 코드 배포
-- 사이에 어느 순서로도 피할 수 없는 "함수 없음" 창이 생긴다(PostgREST 스키마 캐시 리로드
-- 지연까지 더해진다).
--
-- 그래서 새 이름으로 만들고 구버전을 **그대로 둔다**. 마이그레이션이 먼저 적용돼도 옛 코드는
-- 옛 함수를 계속 부르고, 코드가 배포되면 새 함수로 넘어간다. 구버전 제거는 호출자가 0이 된
-- 뒤 별도 마이그레이션에서 한다(3단계 배포).
--
-- ## 인가는 어디서 하는가
--
-- 옛 함수는 `is_admin()` 으로 검사했다. 그 함수는 `auth.uid()` 를 보는데, 호출자는
-- service_role 클라이언트라 `auth.uid()` 가 NULL 이다 — 즉 그 검사는 이 경로에서 애초에
-- 통과할 수 없거나, SECURITY DEFINER 조합에 따라 무의미했다. 새 함수는 **인가를 하지
-- 않는다.** 대신 라우트가 `requireFactoryUser(request, ['admin'])` 로 세션·역할·공장을 모두
-- 확정한 뒤 그 공장 id 를 넘긴다. 검사를 두 곳에 두면 한쪽만 바뀌어 갈라지므로, 있는 곳을
-- 하나로 정한다.
--
-- 그 대신 EXECUTE 는 `service_role` 에만 준다. authenticated 가 직접 부를 수 있으면 인가가
-- 라우트에만 있다는 전제가 깨진다.

begin;

create or replace function public.update_system_setting_scoped(
  p_factory_id uuid,
  p_category text,
  p_key text,
  p_value text,
  p_reason text default null,
  p_changed_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_setting_id uuid;
  v_old_value jsonb;
  v_new_value jsonb;
begin
  if p_factory_id is null then
    raise exception 'p_factory_id is required';
  end if;

  -- 값 인코딩 규칙은 옛 함수와 **글자 그대로** 같다. 여기서 "개선"하면 두 함수가 서로 다른
  -- 방식으로 저장하게 되고, 3단계 배포 중간에 저장된 값이 어느 쪽 규칙인지 알 수 없어진다.
  begin
    v_new_value := jsonb_build_object('value', to_jsonb(p_value::text));
    if p_value ~ '^[\[\{].*[\]\}]$' or p_value ~ '^".*"$' or p_value in ('true', 'false', 'null') or p_value ~ '^\d+(\.\d+)?$' then
      v_new_value := jsonb_build_object('value', p_value::jsonb);
    end if;
  exception when others then
    v_new_value := jsonb_build_object('value', p_value);
  end;

  select id, setting_value into v_setting_id, v_old_value
  from system_settings
  where factory_id = p_factory_id
    and category = p_category
    and setting_key = p_key;

  if v_setting_id is not null then
    update system_settings
    set setting_value = v_new_value,
        updated_at = now(),
        updated_by = p_changed_by
    -- id 만으로 갱신해도 위 SELECT 가 공장을 걸었으니 같은 행이다. 그래도 조건을 함께 거는
    -- 이유는, 이 UPDATE 만 따로 읽는 사람에게 공장 경계가 보여야 하기 때문이다.
    where id = v_setting_id and factory_id = p_factory_id;

    insert into system_settings_audit (
      factory_id, setting_id, category, setting_key, old_value, new_value,
      action, changed_by, change_reason
    ) values (
      p_factory_id, v_setting_id, p_category, p_key, v_old_value, v_new_value,
      'UPDATE', p_changed_by, p_reason
    );
  else
    insert into system_settings (
      factory_id, category, setting_key, setting_value, default_value,
      description, data_type, is_active, is_system,
      created_by, updated_by
    ) values (
      p_factory_id, p_category, p_key, v_new_value, v_new_value,
      p_key || ' setting', 'string', true, false,
      p_changed_by, p_changed_by
    ) returning id into v_setting_id;

    insert into system_settings_audit (
      factory_id, setting_id, category, setting_key, new_value,
      action, changed_by, change_reason
    ) values (
      p_factory_id, v_setting_id, p_category, p_key, v_new_value,
      'CREATE', p_changed_by, p_reason
    );
  end if;

  return jsonb_build_object('success', true, 'setting_id', v_setting_id);
end;
$function$;

create or replace function public.update_system_settings_batch_scoped(
  p_factory_id uuid,
  p_updates jsonb,
  p_reason text default null,
  p_changed_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_count integer := 0;
begin
  if p_factory_id is null then
    raise exception 'p_factory_id is required';
  end if;

  -- 배열이 아니면 조용히 0건 처리하지 말고 거부한다. "성공했는데 아무것도 안 바뀜"은
  -- 호출자가 알아채기 가장 어려운 실패다.
  if p_updates is null or jsonb_typeof(p_updates) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'updates_must_be_array');
  end if;

  if jsonb_array_length(p_updates) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'updates_empty');
  end if;

  for v_item in select value from jsonb_array_elements(p_updates) loop
    if coalesce(v_item->>'category', '') = '' or coalesce(v_item->>'setting_key', '') = '' then
      -- 예외로 던져 트랜잭션 전체를 되돌린다. 이 항목만 건너뛰면 부분 반영이 되어
      -- 애초에 없애려던 상태로 돌아간다.
      raise exception 'category/setting_key is required in every update item';
    end if;

    perform public.update_system_setting_scoped(
      p_factory_id,
      v_item->>'category',
      v_item->>'setting_key',
      v_item->>'setting_value',
      p_reason,
      p_changed_by
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;

-- ⚠️ 이 revoke/grant 는 생략할 수 없다.
--
-- 20260729190000 의 `alter default privileges ... revoke execute on functions from public` 로
-- 새 함수는 아무 권한 없이 태어나지만, Supabase 는 마이그레이션 후 PUBLIC EXECUTE 를 되돌려
-- 부여하는 경우가 있다(2026-07-29 실측). 그래서 열거하지 말고 **전수 회수** 후 필요한 곳에만
-- 다시 준다.
revoke all on function public.update_system_setting_scoped(uuid, text, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.update_system_settings_batch_scoped(uuid, jsonb, text, uuid)
  from public, anon, authenticated;

-- 호출자는 `/api/system-settings/update` 라우트(service_role)뿐이다. 인가가 라우트에만
-- 있으므로 authenticated 에 주면 그 전제가 곧바로 깨진다.
grant execute on function public.update_system_setting_scoped(uuid, text, text, text, text, uuid)
  to service_role;
grant execute on function public.update_system_settings_batch_scoped(uuid, jsonb, text, uuid)
  to service_role;

commit;
