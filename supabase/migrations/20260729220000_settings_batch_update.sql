-- 적대적 재감사 #9 — 교대 설정 저장을 원자적으로 만든다.
--
-- ## 무엇이 문제였나
--
-- 교대 설정 화면은 네 개 값(A시작·B시작·휴식·전환유예)을 **각각 독립 요청**으로 저장했다:
--
--   for (const update of updates) {
--     const success = await updateSetting(...);   // ← 요청 4번
--     if (!success) throw ...;                    // ← 두 번째에서 실패하면 첫 번째는 이미 저장됨
--   }
--
-- 세 번째에서 실패하면 앞의 둘은 남고 뒤의 하나는 안 남는다. 그런데 이 네 값은 **서로를
-- 해석하는** 값이다 — A시작과 B시작이 교대 창의 경계를 함께 정하고, 휴식은 계획가동시간을
-- 빼고, 유예는 진척/마감 창을 나눈다. 반쪽만 반영된 상태는 "설정이 좀 틀린" 게 아니라
-- **어느 세대의 규칙으로 계산된 것인지 알 수 없는** 상태다. 그 상태로 계산된 OEE 는
-- 나중에 되짚을 수도 없다.
--
-- `updateMultipleSettings` 도 답이 아니었다 — 안이 `Promise.all(updates.map(updateSetting))`
-- 이라 부분 실패가 똑같이 남는다. 병렬이라 오히려 어느 것이 남았는지 예측하기 더 어렵다.
--
-- ## 해법
--
-- plpgsql 함수 하나는 **한 트랜잭션**이다. 루프 안에서 예외가 나면 앞선 UPDATE 도 함께
-- 되돌아간다. 감사 로그(system_settings_audit)까지 같은 트랜잭션이라 이력도 어긋나지 않는다.
--
-- 기존 `update_system_setting` 을 그대로 재사용한다. 값 인코딩 규칙(문자열/숫자/불리언
-- 판별)과 감사 기록이 이미 거기 있고, 그걸 여기서 다시 구현하면 두 벌이 되어 언젠가
-- 갈라진다. 이 마이그레이션이 고치려는 결함이 정확히 그 부류다.

create or replace function public.update_system_settings_batch(
  p_updates jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_count integer := 0;
begin
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

    -- 인가는 여기서 다시 하지 않는다 — update_system_setting 이 SECURITY DEFINER 로
    -- is_admin() 을 검사한다. 두 곳에서 검사하면 한쪽만 바뀌어 갈라진다.
    perform public.update_system_setting(
      v_item->>'category',
      v_item->>'setting_key',
      v_item->>'setting_value',
      p_reason
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'updated', v_count);
end;
$$;

-- ⚠️ 이 grant 는 생략할 수 없다.
--
-- 20260729190000 에서 `alter default privileges ... revoke execute on functions from public`
-- 을 걸었기 때문에, 이제 새로 만드는 함수는 **아무에게도** EXECUTE 가 없는 상태로 태어난다.
-- 이 함수가 그 규칙을 처음 만나는 함수다. 빠뜨리면 배포 직후 설정 저장이 42501 로 실패한다
-- — 조용히 열려 있는 것보다 시끄럽게 깨지는 쪽을 고른 결과이고, 의도한 대로다.
--
-- 호출자는 `/api/system-settings/update` 라우트(service_role)뿐이다. 브라우저에서 직접
-- 부를 이유가 없으므로 authenticated 에는 주지 않는다.
grant execute on function public.update_system_settings_batch(jsonb, text) to service_role;
