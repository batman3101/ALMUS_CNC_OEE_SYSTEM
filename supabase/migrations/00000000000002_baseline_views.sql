-- 운영 baseline: 저장소에 정의가 없던 뷰 5개 (2026-08-21 실측 추출)
--
-- 테이블 11개, 함수 9개에 이어 세 번째 같은 구멍이다. 로컬 적용이 여기서 멈췄다:
--
--   Applying migration 20260715210000_security_invoker_views.sql...
--   ERROR: relation "public.current_machine_status" does not exist (SQLSTATE 42P01)
--
-- 그 마이그레이션은 뷰를 `security_invoker = true` 로 **바꾸기만** 한다. 만드는 문장은
-- 저장소 어디에도 없었다.
--
-- 여기서는 `security_invoker` 없이 만든다. 곧이어 20260715210000 이 켜기 때문이다 —
-- baseline 은 개선이 아니라 **시퀀스 시작 상태의 재현**이므로, 나중 마이그레이션이 할 일을
-- 미리 해 버리면 그 마이그레이션이 무의미해지고 회귀 검사도 함께 죽는다.

begin;

-- 설비의 현재 상태와 **그 상태가 시작된 시각**.
-- state_start_time 은 열린 machine_logs 행에서 온다 — machines 행은 "지금 무엇인가"만 알고
-- "언제부터인가"는 모른다.
create or replace view public.current_machine_status as
 SELECT id,
    name,
    location,
    equipment_type AS model_type,
    is_active,
    COALESCE(( SELECT machine_logs.state
           FROM machine_logs
          WHERE machine_logs.machine_id = m.id AND machine_logs.end_time IS NULL
          ORDER BY machine_logs.start_time DESC
         LIMIT 1), 'NORMAL_OPERATION'::text) AS current_state,
    ( SELECT machine_logs.start_time
           FROM machine_logs
          WHERE machine_logs.machine_id = m.id AND machine_logs.end_time IS NULL
          ORDER BY machine_logs.start_time DESC
         LIMIT 1) AS state_start_time
   FROM machines m
  WHERE is_active = true;

create or replace view public.latest_oee_metrics as
 SELECT pr.record_id,
    pr.machine_id,
    pr.date,
    pr.shift,
    pr.planned_runtime,
    pr.actual_runtime,
    pr.ideal_runtime,
    pr.output_qty,
    pr.defect_qty,
    pr.availability,
    pr.performance,
    pr.quality,
    pr.oee,
    pr.created_at,
    m.name AS machine_name,
    m.location
   FROM production_records pr
     JOIN machines m ON pr.machine_id = m.id
  WHERE ((pr.machine_id, pr.date) IN ( SELECT production_records.machine_id,
            max(production_records.date) AS max
           FROM production_records
          GROUP BY production_records.machine_id));

create or replace view public.machine_status_statistics as
 SELECT ms.current_state,
    msd.description_ko,
    msd.description_vi,
    msd.description_en,
    msd.color_code,
    msd.is_productive,
    msd.display_order,
    count(ms.*) AS machine_count,
    round(count(ms.*)::numeric * 100.0 / NULLIF(sum(count(ms.*)) OVER (), 0::numeric), 2) AS percentage
   FROM machines ms
     LEFT JOIN machine_status_descriptions msd ON ms.current_state = msd.status
  WHERE ms.is_active = true
  GROUP BY ms.current_state, msd.description_ko, msd.description_vi, msd.description_en,
           msd.color_code, msd.is_productive, msd.display_order
  ORDER BY msd.display_order;

-- 주의: current_tact_time 은 **1개당** 시간이다. current_cavity_count 로 나누지 말 것.
create or replace view public.machines_with_production_info as
 SELECT m.id,
    m.name,
    m.location,
    m.equipment_type,
    m.current_state,
    m.is_active,
    m.created_at,
    m.updated_at,
    m.production_model_id,
    m.current_process_id,
    pm.model_name AS production_model_name,
    pm.description AS production_model_description,
    mp.process_name AS current_process_name,
    mp.process_order AS current_process_order,
    mp.tact_time_seconds AS current_tact_time,
    mp.cavity_count AS current_cavity_count
   FROM machines m
     LEFT JOIN product_models pm ON m.production_model_id = pm.id
     LEFT JOIN model_processes mp ON m.current_process_id = mp.id;

create or replace view public.recent_machine_status_changes as
 SELECT msh.id,
    msh.machine_id,
    m.name AS machine_name,
    msh.previous_status,
    prev_desc.description_ko AS previous_status_ko,
    msh.new_status,
    new_desc.description_ko AS new_status_ko,
    msh.change_reason,
    msh.duration_minutes,
    msh.created_at,
    up.name AS changed_by_name
   FROM machine_status_history msh
     JOIN machines m ON msh.machine_id = m.id
     LEFT JOIN machine_status_descriptions prev_desc ON msh.previous_status = prev_desc.status
     LEFT JOIN machine_status_descriptions new_desc ON msh.new_status = new_desc.status
     LEFT JOIN user_profiles up ON msh.changed_by = up.user_id
  ORDER BY msh.created_at DESC
 LIMIT 100;

commit;
