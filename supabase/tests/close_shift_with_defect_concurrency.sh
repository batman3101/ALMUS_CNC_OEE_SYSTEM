#!/usr/bin/env bash
# 감사 2026-09-28 F-01 회귀 — 로컬 Supabase DB(docker supabase_db_CNC_OEE)의 **실제 두 세션**으로 본다.
#
#   [옛 방식] 라우트가 close_shift_upsert_v3 → confirm_shift_defect 를 따로 부르던 순서를 그대로 재연한다:
#             A 마감(100) · B 마감(200)+불량(20) · A 불량(10)  ⇒ 생산 200·불량 10 (누구도 입력하지 않은 조합)
#             이것이 재현되어야 이 테스트가 경합을 "볼 수 있다"는 증거가 된다.
#   [새 방식] A 가 close_shift_with_defect(100,10) 트랜잭션을 연 채 붙잡고 있는 동안 B 가 (200,20) 을 부른다.
#             B 는 A 가 끝날 때까지 기다린 뒤 already_closed 를 받고, 기록은 A 의 완전한 쌍(100/10)이어야 한다.
#
# 로컬 전용. 2099-04-01 픽스처를 만들고 지운다. 실행: bash supabase/tests/close_shift_with_defect_concurrency.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1
PSQL=(docker exec -i supabase_db_CNC_OEE psql -U postgres -v ON_ERROR_STOP=1 -qtA)

M=$("${PSQL[@]}" -c "select id from machines where is_active and current_state = 'NORMAL_OPERATION' order by name limit 1")
D="2099-04-01"; WS="2099-04-01 08:00+07"; WE="2099-04-01 20:00+07"

cleanup() {
  "${PSQL[@]}" -c "delete from production_records where machine_id = '$M' and date = '$D';
                   delete from production_progress_reports where machine_id = '$M' and date = '$D';
                   delete from production_shift_states where machine_id = '$M' and date = '$D';" >/dev/null
}
fixture() {
  cleanup
  "${PSQL[@]}" -c "select report_shift_progress('$M', '$D', 'A', 50, null);" >/dev/null
  DIGEST=$("${PSQL[@]}" -c "select downtime_window_digest('$M', '$WS', '$WE')")
}
v3() { # $1 output
  echo "select close_shift_upsert_v3('$M','$D','A',$1,610,610,$(( $1 * 5 )),1,0.8,0,300,'$WS','$WE','$DIGEST',null,null);"
}
confirm() { # $1 defect
  echo "select confirm_shift_defect((select record_id from production_records where machine_id='$M' and date='$D' and shift='A'), $1);"
}
withdefect() { # $1 output $2 defect
  echo "select close_shift_with_defect('$M','$D','A',$1,610,610,$(( $1 * 5 )),1,0.8,0,300,'$WS','$WE','$DIGEST',null,null,$2);"
}
row() { "${PSQL[@]}" -c "select output_qty || '/' || coalesce(defect_qty::text,'null') from production_records where machine_id='$M' and date='$D' and shift='A'"; }
trap cleanup EXIT

# ── 옛 방식: 두 번 따로 부르면 섞인다 ──
fixture
"${PSQL[@]}" -c "$(v3 100)" >/dev/null
"${PSQL[@]}" -c "$(v3 200)" >/dev/null; "${PSQL[@]}" -c "$(confirm 20)" >/dev/null
"${PSQL[@]}" -c "$(confirm 10)" >/dev/null
OLD=$(row); echo "[옛 방식] 최종 기록 = $OLD"
if [ "$OLD" != "200/10" ]; then echo "FAIL: 옛 방식 경합을 재현하지 못했다 — 테스트가 경합을 볼 수 없다"; exit 1; fi

# ── 새 방식: A 가 트랜잭션을 붙잡은 동안 B 가 들어온다 ──
fixture
( printf '%s\n' "begin;" "$(withdefect 100 10)" "select pg_sleep(4);" "commit;" | "${PSQL[@]}" >/dev/null ) &
A=$!
sleep 1
START=$(date +%s)
B_OUT=$("${PSQL[@]}" -c "$(withdefect 200 20)")
WAITED=$(( $(date +%s) - START ))
wait $A
NEW=$(row); echo "[새 방식] B 응답 = $B_OUT (대기 ${WAITED}s), 최종 기록 = $NEW"
if [ "$NEW" != "100/10" ]; then echo "FAIL: 기록이 A 의 완전한 쌍(100/10)이 아니다"; exit 1; fi
if ! grep -q '"already_closed"' <<<"$B_OUT"; then echo "FAIL: B 가 already_closed 를 받지 않았다"; exit 1; fi
if [ "$WAITED" -lt 2 ]; then echo "FAIL: B 가 A 의 잠금을 기다리지 않았다"; exit 1; fi

echo "PASS: 옛 방식은 200/10 으로 섞였고, 새 방식은 B 가 A 를 기다린 뒤 already_closed — 기록은 100/10"
