#!/usr/bin/env bash
# Audit BUG-02 regression — two real sessions against the LOCAL Supabase DB (docker container supabase_db_CNC_OEE).
#
#   B: changes a machine the plan KEEPS and holds the transaction open.
#   A: tries to confirm the plan meanwhile.
#
# Fixed confirm_layout_plan (20260928110000): A must wait for B (lock_timeout → error), so the plan can never
# be confirmed on a base that is being changed. The old body (20260925110000) is run in the same way as a
# mutation check: it must confirm right through B — proving the test can see the race at all.
#
# Local only; creates and removes its own fixture (ZZ_CONC_* models, one plan). Usage: bash supabase/tests/layout_confirm_concurrency.sh
set -euo pipefail
PSQL=(docker exec -i supabase_db_CNC_OEE psql -U postgres -v ON_ERROR_STOP=1 -qtA)

setup=$("${PSQL[@]}" <<'SQL'
do $$
declare v_alt uuid; v_a uuid; v_a1 uuid; v_change uuid; v_keep uuid; r jsonb;
begin
  select id into v_alt from factories where code = 'ALT';
  delete from layout_plans where title = 'ZZ_CONC';
  delete from product_models where factory_id = v_alt and model_name = 'ZZ_CONC_A';
  insert into product_models (factory_id, model_name, is_active) values (v_alt, 'ZZ_CONC_A', true) returning id into v_a;
  insert into model_processes (factory_id, model_id, process_name, process_order, tact_time_seconds) values (v_alt, v_a, 'CNC #1', 1, 500) returning id into v_a1;
  select id into v_change from machines where factory_id = v_alt and is_active order by name limit 1;
  r := create_layout_plan(v_alt, null,
    jsonb_build_object('title', 'ZZ_CONC', 'forecast_file_name', 'f', 'forecast_file_hash', 'h', 'target_week', 'w', 'period_start', '2099-02-01', 'period_end', '2099-02-07'),
    '[]'::jsonb, jsonb_build_array(jsonb_build_object('machine_id', v_change, 'recommended_model_id', v_a, 'recommended_process_id', v_a1)));
end $$;
select p.id || ' ' || (select a.machine_id from layout_plan_assignments a where a.plan_id = p.id
                        and a.final_model_id is not distinct from a.base_model_id order by a.machine_id desc limit 1)
  from layout_plans p where p.title = 'ZZ_CONC';
SQL
)
read -r PLAN KEEP <<<"$setup"
FACTORY=$("${PSQL[@]}" -c "select id from factories where code='ALT'")
echo "plan=$PLAN keep=$KEEP"

old_confirm=$(sed -n '/^create or replace function public.confirm_layout_plan(/,/^\$\$;/p' supabase/migrations/20260925110000_layout_planning_rpcs.sql)

run_race() { # $1 = label, $2 = extra SQL run inside A's transaction before confirming (the mutation)
  ( "${PSQL[@]}" -c "begin; update machines set production_model_id = null, current_process_id = null where id = '$KEEP'; select pg_sleep(6); rollback;" >/dev/null ) &
  local holder=$!
  sleep 1.5
  local out
  out=$(printf '%s\n' "begin;" "$2" "set local lock_timeout = '2s';" \
        "select confirm_layout_plan('$FACTORY', '$PLAN', 1, null);" "rollback;" | "${PSQL[@]}" 2>&1 || true)
  wait $holder
  echo "[$1] $out" | tr '\n' ' '; echo
  RESULT="$out"
}

run_race "fixed" ""
if ! grep -q "lock timeout" <<<"$RESULT"; then echo "FAIL: fixed confirm did not wait for the concurrent change"; exit 1; fi

run_race "old body (mutation)" "$old_confirm"
if ! grep -q "changed_machines" <<<"$RESULT"; then echo "FAIL: mutation not detected — the test cannot see the race"; exit 1; fi

"${PSQL[@]}" -c "delete from layout_plans where title = 'ZZ_CONC'; delete from product_models where model_name = 'ZZ_CONC_A';" >/dev/null
echo "PASS: confirm waits for a concurrent change to a kept machine (old body confirmed straight through it)"
