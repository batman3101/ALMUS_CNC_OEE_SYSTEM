-- ALV 공장 생성 + 기존 사용자 ALT 배정
--
-- 운영 결정 2026-08-24:
--   1. ALV 의 timezone·기본 언어는 ALT 와 동일하게 둔다.
--   2. 기존 auth 사용자는 전원 ALT 로 고정한다. 시스템 관리자만 양쪽을 관리한다.
--   6. 설비번호 체계는 두 공장이 동일하다 (ALT 800대 / ALV 350대, 둘 다 CNC-nnn).
--
-- ## ⚠ 이 마이그레이션은 계약의 H7 대상이다
--
-- 계약 7절 P5 는 ALV 데이터 생성을 마지막 단계로 두고, "이 contract 가 통과하기 전에는
-- ALV 데이터나 사용자를 만들지 않는다"고 명시한다. 그래서 이 파일은 **작성해 두되 운영에
-- 적용하지 않는다.** 적용 순서는 P2~P4(운영 expand → backfill → cutover → contract)가
-- 끝난 뒤다.
--
-- 여기 미리 써 두는 이유는 값이 확정됐기 때문이다. 확정된 것을 적어 두지 않으면 나중에
-- 다시 추측하게 된다.
--
-- ## ALV 설비는 만들지 않는다
--
-- 350대의 실제 목록(위치·모델·공정)은 아직 없다. 이름 규칙만 확정됐다(CNC-001~CNC-350).
-- 빈 이름만 만들어 두면 실제 등록 때 지우고 다시 만들어야 하고, 그 사이 그 행들이
-- "존재하지만 쓸 수 없는 설비"로 보인다. 설비 등록은 별도 작업으로 남긴다.

begin;

-- ---------------------------------------------------------------------------
-- 1. ALV 공장
-- ---------------------------------------------------------------------------
-- timezone 과 언어는 ALT 에서 **읽어서** 복사한다. 문자열을 다시 적으면 나중에 ALT 가
-- 바뀌었을 때 두 값이 조용히 갈라진다. "동일하게"라는 결정을 코드가 직접 표현한다.
insert into public.factories (code, name, timezone, default_language, is_active)
select 'ALV', 'ALMUS VINA', f.timezone, f.default_language, true
from public.factories f
where f.code = 'ALT'
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. 기존 사용자 전원 ALT membership
-- ---------------------------------------------------------------------------
-- 역할은 전환 기간 동안 `user_profiles.role` 에서 가져온다. 그 값이 지금까지 실제로
-- 쓰이던 권한이므로, 옮기는 시점에 권한이 바뀌지 않는다 — 이행에서 가장 중요한 성질이다.
--
-- 비활성 계정도 membership 을 만든다. is_active 를 그대로 옮겨야 "비활성이었다"는 사실이
-- 보존되고, 나중에 되살릴 때 역할을 다시 추측하지 않는다.
insert into public.factory_memberships (factory_id, user_id, role, is_active)
select (select id from public.factories where code = 'ALT'),
       up.user_id,
       up.role,
       coalesce(up.is_active, false)
from public.user_profiles up
where up.role in ('admin', 'engineer', 'operator')
on conflict (factory_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. operator 담당 설비 이전
-- ---------------------------------------------------------------------------
-- `user_profiles.assigned_machines` 는 text[] 라 참조 무결성이 없다. 삭제된 설비 id 가
-- 배열에 남아 있어도 DB 는 모른다. 그래서 **실재하는 설비만** 옮긴다 — join 이 그 필터다.
--
-- 옮겨지지 않은 항목은 아래 4절이 보고한다. 조용히 버리면 담당이 줄어든 것을 아무도 모른다.
insert into public.user_machine_assignments (factory_id, user_id, machine_id, is_active)
select m.factory_id, up.user_id, m.id, true
from public.user_profiles up
cross join lateral unnest(coalesce(up.assigned_machines, '{}')) as a(machine_text)
join public.machines m on m.id::text = a.machine_text
where up.role = 'operator'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. 이전 결과 보고
-- ---------------------------------------------------------------------------
do $$
declare
  v_members  bigint;
  v_assigned bigint;
  v_orphaned bigint;
begin
  select count(*) into v_members from public.factory_memberships;
  select count(*) into v_assigned from public.user_machine_assignments;

  -- 배열에는 있었는데 실재하지 않아 옮겨지지 않은 설비 id 수.
  select count(*) into v_orphaned
  from public.user_profiles up
  cross join lateral unnest(coalesce(up.assigned_machines, '{}')) as a(machine_text)
  where up.role = 'operator'
    and not exists (select 1 from public.machines m where m.id::text = a.machine_text);

  raise notice 'membership %건, 담당설비 %건 이전 완료', v_members, v_assigned;

  if v_orphaned > 0 then
    raise warning '담당 설비 배열에 실재하지 않는 설비 id 가 %건 있었고 이전되지 않았다. '
                  '해당 운영자의 담당 목록을 확인할 것', v_orphaned;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Global Admin 은 여기서 만들지 않는다
-- ---------------------------------------------------------------------------
-- 계약 1절: "기존 ALT 관리자를 자동으로 Global Admin 으로 승격하지 않는다."
--
-- 시스템 관리자가 양쪽을 관리하기로 했지만(결정 2), 그것을 **마이그레이션이 자동으로**
-- 부여하면 계약이 금지한 바로 그 형태가 된다. 대상이 한 명이라도 마찬가지다 — 규칙의
-- 요점은 인원수가 아니라 "누가 언제 무엇을 부여했는지가 기록에 남는가"이다.
--
-- 등록은 아래를 사람이 실행한다(user_id 를 실제 값으로 바꿔서):
--
--   insert into public.factory_memberships (factory_id, user_id, role, is_active)
--   values ((select id from public.factories where code='ALV'), '<user_id>', 'admin', true);
--
--   insert into public.global_admins (user_id, is_active, granted_by, reason, home_factory_id)
--   values ('<user_id>', true, '<granted_by>', 'ALT/ALV 공동 관리 (2026-08-24 결정)',
--           (select id from public.factories where code='ALT'));
--
-- home_factory_id 를 ALT 로 두는 이유: 공장 전환 토글이 없으므로 host 가 해석되지 않는
-- 접속에서는 ALT 로 들어간다. ALV 는 `alv.<domain>` 으로 들어간다.

commit;
