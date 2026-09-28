-- Layout 계획: "모델만 있고 공정이 비어 있는" 설비를 받아들인다 (2026-09-28 운영 적용 후 발견).
--
-- 20260925100000 은 모든 (모델, 공정) 쌍에 "둘 다 있거나 둘 다 없음" 검사를 걸었다. 그런데 운영 ALT 에는
-- 모델만 지정되고 공정이 NULL 인 활성 설비가 5대 있다(B6SUB 2, M1 2, M3 1 — 2026-09-28 실측). 계획은 기준(base)을
-- machines 에서 그대로 복사하므로 이 5대 때문에 create_layout_plan 이 23514 로 실패해, 계획을 하나도 만들 수 없었다.
-- 로컬 픽스처에는 이런 설비가 없어 로컬 검증을 통과했다.
--
-- 규칙:
--   * base / before  = 현실의 기록이다. 반쪽 상태도 그대로 받는다.
--   * recommended / final / target = 계획이 만드는 값이다. 새 반쪽 상태는 여전히 금지 — 단, 기준과 같은 값
--     (그 설비를 건드리지 않음)이면 허용한다. 계획은 손대지 않은 설비를 "고치지" 않는다.
-- (모델, 공정) FK 는 MATCH SIMPLE 이라 공정이 NULL 이면 검사하지 않는다 — 바꿀 필요 없다.
-- 표들은 2026-09-28 에 비어 있는 상태로 만들어졌으므로 제약을 바꾸는 데 데이터 영향은 없다.

begin;

alter table public.layout_plan_assignments drop constraint layout_plan_assignments_base_pair;

alter table public.layout_plan_assignments drop constraint layout_plan_assignments_recommended_pair;
alter table public.layout_plan_assignments add constraint layout_plan_assignments_recommended_pair check (
  (recommended_model_id is null) = (recommended_process_id is null)
  or (recommended_model_id is not distinct from base_model_id and recommended_process_id is not distinct from base_process_id)
);

alter table public.layout_plan_assignments drop constraint layout_plan_assignments_final_pair;
alter table public.layout_plan_assignments add constraint layout_plan_assignments_final_pair check (
  (final_model_id is null) = (final_process_id is null)
  or (final_model_id is not distinct from base_model_id and final_process_id is not distinct from base_process_id)
);

alter table public.machine_setup_tasks drop constraint machine_setup_tasks_before_pair;

commit;
