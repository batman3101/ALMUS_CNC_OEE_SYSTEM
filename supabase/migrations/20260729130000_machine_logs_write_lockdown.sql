-- Codex 감사(2026-07-29) HIGH #3 수정 1/2: machine_logs 의 authenticated 쓰기 차단.
--
-- ⚠ 이 마이그레이션은 아직 운영에 적용하지 않았다. 적용 전 확인 사항은 파일 끝 참조.
--
-- ══ 무엇이 문제였나 ═══════════════════════════════════════════════════════
--
-- 20260715200000 이 남긴 정책:
--
--     "Authenticated can access machine_logs" | FOR ALL TO authenticated
--       USING (true) WITH CHECK (true)
--
-- 즉 **로그인한 아무나 아무 설비의 상태 이력을 INSERT/UPDATE/DELETE 할 수 있다.**
-- machine_logs 는 비가동 계산의 두 원천 중 하나이므로(src/lib/shiftDowntime.ts),
-- 이것은 곧 OEE 조작 경로다. API 의 assertMachineAccess 는 라우트 안에서만 동작하고,
-- 브라우저 번들에 실린 anon 키 + 자기 JWT 로 PostgREST 를 직접 치면 그 검사를 지나친다.
--
-- ══ 왜 그렇게 열어 두었나 ════════════════════════════════════════════════
--
-- 20260715200000 의 설계 주석이 이유를 적어 두었다:
--
--   > machine_logs: SECURITY INVOKER 트리거 log_machine_status_change 가 쓰는데, 이 트리거는
--   > public.machines 를 갱신하는 authenticated 사용자로 실행된다. authenticated 쓰기를
--   > 없애면 설비 상태 변경이 깨진다.
--
-- 근거 자체는 사실이다(운영 DB 에서 prosecdef = false 확인). 다만 그 제약은 **트리거를
-- SECURITY DEFINER 로 승격하면 사라진다.** 트리거가 소유자 권한으로 돌면 RLS 를 우회해
-- machine_logs 를 쓰므로, 사용자에게 직접 쓰기 권한을 줄 이유가 없어진다.
--
-- ══ 무엇을 바꾸는가 ══════════════════════════════════════════════════════

-- 1) 트리거를 SECURITY DEFINER 로 승격한다. 본문은 운영 최종 정의와 **동일**하다
--    (pg_get_functiondef 로 받아 그대로 옮겼다) — security definer 한 줄만 추가했다.
--
--    search_path 고정은 DEFINER 함수의 필수 규율이다. 이미 설정돼 있던 값을 유지한다.
--
--    auth.uid() 는 DEFINER 아래에서도 그대로 동작한다 — 실행 role 이 아니라 요청의 JWT
--    GUC 를 읽기 때문이다. 따라서 operator_id 귀속이 바뀌지 않는다.
create or replace function public.log_machine_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
    log_state text;
    v_operator uuid;
begin
    -- 사유 정정: 상태 전이가 아니므로 열린 로그를 닫지 않는다. 정정 RPC 가 machine_logs.state
    -- 를 직접 갱신하고, 이 트리거는 비켜선다.
    if coalesce(nullif(current_setting('app.suppress_status_log', true), ''), '0') = '1' then
        return new;
    end if;

    -- machine_status ENUM 값은 machine_logs 허용 값과 1:1 이다. 알 수 없는 값만 방어한다.
    log_state := case
        when new.current_state::text in (
            'NORMAL_OPERATION', 'INSPECTION', 'BREAKDOWN_REPAIR', 'PM_MAINTENANCE',
            'MODEL_CHANGE', 'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP'
        ) then new.current_state::text
        else 'NORMAL_OPERATION'
    end;

    -- service_role 경유(RPC)에서는 auth.uid() 가 NULL 이므로 호출자가 심은 GUC 를 우선한다.
    v_operator := coalesce(
        nullif(current_setting('app.status_operator_id', true), '')::uuid,
        auth.uid()
    );

    update machine_logs
    set end_time = now(),
        duration = extract(epoch from (now() - start_time)) / 60
    where machine_id = new.id
      and end_time is null;

    insert into machine_logs (machine_id, state, start_time, end_time, operator_id, created_at)
    values (new.id, log_state, now(), null, v_operator, now());

    return new;
end;
$function$;

-- 2) 쓰기 정책을 철회하고 읽기만 남긴다.
--    (읽기 범위 축소는 다음 마이그레이션에서 따로 다룬다 — 한 번에 둘을 바꾸면 무엇이
--     깨졌는지 알 수 없다)
drop policy if exists "Authenticated can access machine_logs" on public.machine_logs;

create policy "Authenticated can read machine_logs"
  on public.machine_logs
  for select to authenticated
  using (true);

-- ══ 적용 전 확인 (운영 반영 시 순서대로) ═══════════════════════════════════
--
-- 1. 관리자/엔지니어 계정으로 설비 상태를 변경하고 machine_logs 에 행이 생기는지 확인.
--    (트리거 DEFINER 승격이 실제로 동작하는지 — 이 마이그레이션의 핵심 가정)
-- 2. 운영자 콘솔에서 andon 시작/재개가 정상 동작하는지 확인.
--    (toggle_machine_downtime 은 service_role 이므로 영향 없어야 하지만, 트리거를 타므로 확인)
-- 3. 사유 정정 RPC 가 machine_logs.state 를 갱신하는지 확인
--    (app.suppress_status_log 경로 — 정정 RPC 는 service_role 이라 정책 영향 없음)
-- 4. 브라우저 콘솔에서 anon 키 + 운영자 JWT 로 machine_logs INSERT 를 시도해 **거부**되는지
--    확인. 이것이 이 마이그레이션이 막으려던 바로 그 경로다.
