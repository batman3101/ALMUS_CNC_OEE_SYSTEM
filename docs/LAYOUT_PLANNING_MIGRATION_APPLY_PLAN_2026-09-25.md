# Layout 계획 마이그레이션 적용 절차 (2026-09-25 준비, **운영 미적용**)

운영 적용은 사용자가 "적용해도 좋다"고 말한 뒤에만 한다(전역 규칙). 이 문서는 그때 쓸 절차다.
**코드(API·화면)가 이 테이블을 쓰기 전에는 적용할 이유가 없다.** 기능이 완성돼 함께 내보낼 때 적용한다.

## 1. 무엇이 들어가나

| 순서 | 파일 | 내용 | 기존 데이터 변경 |
|---|---|---|---|
| 1 | `20260925100000_layout_planning_tables.sql` | 표 8개 + RLS(읽기 전용) + 권한. `model_processes(model_id, id)` 고유 인덱스 1개 추가 | 없음 (인덱스만) |
| 2 | `20260925110000_layout_planning_rpcs.sql` | 쓰기 함수 5개 (계획 저장·미세조정·확정·셋업 전이 + 확정 내부용) | 없음 (함수만) |
| 3 | `20260925120000_layout_geometry_alt_w39.sql` | 1공장(ALT) 도면 1건 + 설비 위치 800행 | 없음 (새 표에 추가만) |

표 8개와 요구사항의 연결:

| 표 | 쓰임 | 요구 |
|---|---|---|
| `layout_geometries`, `machine_layout_positions` | 도면·설비 좌표(그룹화의 "이웃" 판정, 도면 그리기) | 1, 4 |
| `forecast_model_mappings` | Forecast 약어 → 앱 모델, 사용자가 확정하고 재사용 | 1 |
| `layout_plans` | 시뮬레이션 1회 = 계획 1건, draft → confirmed → superseded | 3 |
| `layout_plan_requirements` | 모델·공정별 최대 수요, T/T·대당 일 CAPA 스냅샷, 필요 대수 | 2, 5 |
| `layout_plan_assignments` | 설비별 기준(현재)/추천/최종(미세조정)·잠금 | 1, 3, 4 |
| `machine_setup_tasks`, `machine_setup_events` | 확정 후 현장 셋업 대기→진행→완료, 이력 | (프리뷰 셋업 기능) |

부족·여유 알림(요구 5)은 `requirements.required_machines` 와 `assignments.final_*` 대수의 차이로 계산한다(따로 저장하지 않는다).

## 2. 적용 전 확인 (읽기 전용)

```sql
-- ALT 에 CNC-001 ~ CNC-800 이 모두 있어야 3번 파일이 성공한다(하나라도 없으면 3번 전체가 취소된다).
select count(*) from machines m join factories f on f.id = m.factory_id and f.code = 'ALT'
 where m.name ~ '^CNC-[0-9]{3}$' and substring(m.name from 5)::int between 1 and 800;   -- 기대: 800
-- 이름 충돌 없음
select to_regclass('public.layout_plans'), to_regproc('public.confirm_layout_plan');     -- 기대: 둘 다 NULL
```

## 3. 적용

- **`supabase db push` 금지** (파일 타임스탬프와 운영 version 이 맞지 않는다 — `docs/MIGRATION_APPLY_PLAN_2026-07-15.md` §0).
- MCP `apply_migration` 으로 1 → 2 → 3 순서대로, 파일 내용 그대로 적용한다.
- 적용한 세션이 `supabase/applied-migrations.json` 의 `applied[]` 와 `hashes` 를 손으로 갱신한다
  (`npm run check:migrations` 는 적용 전까지 이 3개를 "미적용"으로 실패 처리한다 — 정상).

## 4. 적용 후 확인

```sql
-- 롤백형 불변조건 테스트: 'ALL_INVARIANTS_PASSED (L1-L10)' 예외가 나오면 성공(데이터는 남지 않는다).
-- 파일: supabase/tests/layout_planning_invariants.sql
-- anon 권한 누출 없음: supabase/tests/anon_access_invariants.sql → 'ALL_ANON_INVARIANTS_PASSED'
select g.source_sheet, g.is_active, count(p.*) from layout_geometries g
  left join machine_layout_positions p on p.geometry_id = g.id group by 1, 2;              -- 기대: W39 | t | 800
```

`get_advisors`(security) 로 새 경고가 없는지도 본다.

## 5. 되돌리기

새 표·함수만 추가하므로, 기능을 쓰기 전이라면 아래로 원상복구된다. **확정(confirm)을 한 번이라도 실행한 뒤에는**
`machines` 의 모델·공정이 이미 바뀌었으므로 표를 지워도 설비 배정은 돌아오지 않는다 — `audit_log`
(`action = 'LAYOUT_APPLY'`)의 `old_values` 로 복구 대상을 확인해야 한다.

```sql
begin;
drop function if exists public.transition_machine_setup_task(uuid, uuid, integer, text, uuid, text);
drop function if exists public.confirm_layout_plan(uuid, uuid, integer, uuid);
drop function if exists public.apply_layout_machine_assignment(uuid, uuid, uuid, uuid, uuid, uuid);
drop function if exists public.save_layout_plan_draft(uuid, uuid, integer, uuid, jsonb);
drop function if exists public.create_layout_plan(uuid, uuid, jsonb, jsonb, jsonb);
drop table if exists public.machine_setup_events, public.machine_setup_tasks, public.layout_plan_assignments,
  public.layout_plan_requirements, public.layout_plans, public.forecast_model_mappings,
  public.machine_layout_positions, public.layout_geometries;
drop function if exists public.forbid_setup_event_update();
drop index if exists public.uq_model_processes_model_id;
commit;
```

## 6. 로컬 검증 기록 (2026-09-25, 로컬 Supabase / Postgres 17)

- 3개 파일 적용 성공, ALT 도면 800행.
- `layout_planning_invariants.sql` L1–L10 통과. **변이 검사**: 확정의 기준 변경 검사를 빼면 L7 이, 미세조정의
  잠금 검사를 빼면 L3 가 실패함을 확인(검사가 실제로 잡는다).
- 마이그레이션 가드 jest 113개 통과(설비 잠금 규약·공장 범위 규약 포함), `anon_access_invariants`·`factory_isolation` 통과.
- RLS: ALT 관리자 800행, 소속 없는 사용자 0행, anon 거부. **운영자 역할의 셋업 작업 읽기는 로컬에 운영자 계정이 없어 확인하지 못했다.**
