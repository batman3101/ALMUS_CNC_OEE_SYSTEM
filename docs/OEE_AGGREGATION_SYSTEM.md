# OEE 정합성 보정 Edge Function

**최종 실측: 2026-08-06** (운영 Supabase 프로젝트 직접 조회)

이 문서는 한 번 통째로 다시 쓰였다. 이전 판은 **존재한 적 없는 시스템의 설치·운영 절차를
200여 줄** 담고 있었고, 위에 경고 배너를 얹어 두는 방식으로 관리되고 있었다. 그런데 배너는
읽는 사람이 본문을 따라 하는 것을 막지 못한다 — 본문에는 `CREATE EXTENSION pg_cron`,
`cron.schedule(...)`, `SELECT * FROM oee_aggregation_log` 처럼 **그대로 실행 가능한 명령**이
들어 있었고, 그중 어느 것도 이 프로젝트에서 동작하지 않는다.

그래서 계획을 지우고 사실만 남겼다. 원래 설계가 무엇이었는지는 [마지막 절](#부록--원래-설계와-그-행방)에 기록으로 남긴다.

---

## 지금 존재하는 것

| 항목 | 상태 (2026-08-06 실측) |
|---|---|
| Edge Function `daily-oee-aggregation` | **배포됨** · `status=ACTIVE` · `version=2` · `verify_jwt=true` |
| 자동 실행(스케줄) | **없음** |
| `pg_cron` / `pg_net` 확장 | **미설치** (`installed_version = null`, `cron` 스키마 없음) |
| `oee_aggregation_log` 테이블 | **없음** |
| `oee_calculations` 테이블 | **없음** (2026-08-06 제거 — 부록 참조) |
| 앱 안의 호출자 | **없음** |

**요약: 함수는 살아 있지만 아무도 부르지 않는다.** 유효한 관리자 JWT 로 HTTP 호출하면
동작하고, 그것이 유일한 실행 경로다.

- 소스: `supabase/functions/daily-oee-aggregation/index.ts`
- 인가 회귀 검사: `supabase/functions/__tests__/dailyOeeAggregationAuthz.test.ts`

---

## 이 함수가 실제로 하는 일

산술적으로 반박 불가능한 명제 **하나만** 적용한다.

```
output_qty = 0  →  ideal_runtime = 0,  performance = 0,  quality = 0,  oee = 0
```

tact time 도 `planned_runtime` 도 필요 없는 관계다. 이 조건을 위반하는 행만 바로잡는다.

**하지 않는 것:**

- 행을 **INSERT 하지 않는다**
- 작업자 입력값(`planned_runtime`, `actual_runtime`, `output_qty`, `defect_qty`,
  `downtime_minutes`, `availability`)을 **건드리지 않는다**
- 저장된 입력값으로 지표를 **재유도하지 않는다**

`dry_run: true` 를 주면 계산만 하고 쓰지 않는다.

**현재 보정 대상 행 수: 0건** (2026-08-06 실측). 지금 실행하면 아무것도 바뀌지 않는다.

### 왜 이렇게까지 좁은가

이전 구현은 두 가지를 더 했고, 둘 다 **작업자 입력을 파괴**했다. 2026-07-14 에 잘라냈다.

**① 실적 없는 교대에 0% 레코드 INSERT**
입력이 없다는 것은 "실적이 0" 이 아니라 "아직 입력되지 않았다" 이다. 야간조는 20:00 에
시작하므로 주간조 실적을 저장하는 시점에 야간조는 시작도 하지 않았다. 이전 구현은 이런
교대에도 `output_qty=0 / oee=0` 행을 만들어 실행 1회당 최대 1,600개(설비 800 × 2교대)의
유령 행을 생성하고 평균 OEE 를 끌어내렸다. 휴무로 삭제한 기록까지 되살아났다.

**② `machine_logs` 기반 재계산으로 기존 행 UPDATE**
이 시스템의 가동률은 로그가 아니라 **작업자가 입력한 비가동**에서 나온다
(`planned_runtime = 가동분 − 휴식분`, `actual_runtime = planned_runtime − 입력된 비가동`).
게다가 `machine_logs` 는 상태 버튼을 누를 때만 남는 희소한 감사 로그다. 대부분의 교대에
로그가 없어 로그 기반 재계산은 `actual_runtime=0` → 가동률 0% → OEE 0% 로 정상 실적을
뭉갠다. 원본 가동분은 DB 에 없으므로 복구도 불가능하다.

**③ "지표 전체 재계산" 을 하지 않는 이유**
이 DB 의 과거 지표는 여러 세대의 쓰기 경로가 남긴 것이라 저장된 입력값과 일관되지 않다.
실측 결과 저장된 입력값으로 파생 지표를 다시 계산하면 대다수 행이 바뀐다. 특히 레거시
행들은 `planned_runtime=0` 인데 가동률이 0.94 로 저장돼 있어, 재계산하면 가동률과 OEE 가
0 이 된다. **이 데이터에서 "재계산" 은 곧 역사 덮어쓰기다.**

---

## 인가 (2026-07-29 추가)

| 호출자 | 결과 |
|---|---|
| `service_role` 토큰 | 통과 |
| 그 외 유효한 JWT | `admin` + `is_active` 를 요구 |
| 토큰 없음 · 서명 불일치 | 플랫폼의 `verify_jwt` 가 **401** (실측 확인) |

---

## 실행 방법

살아 있는 호출자가 없으므로 필요할 때 직접 부른다.

```bash
# 영향 범위만 확인 (DB 에 쓰지 않음)
curl -X POST "https://<project>.supabase.co/functions/v1/daily-oee-aggregation" \
  -H "Authorization: Bearer <admin 또는 service_role JWT>" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

`dry_run` 을 빼면 실제로 보정한다. 위에 적었듯 현재 대상은 0건이다.

> 스케줄러를 붙이려면 `pg_cron` 설치부터 필요하다. 붙이기 전에 **정말 필요한지** 먼저 볼 것 —
> 보정 대상이 0건인 상태가 계속된다면, 이 함수는 과거 데이터 정리용이었고 이미 그 일을
> 끝냈다는 뜻이다.

---

## 부록 — 원래 설계와 그 행방

이 문서가 원래 설명하던 시스템은 **일별 OEE 미리계산(rollup)** 이었다.

```
야간 배치 → 설비 × 날짜별 OEE 계산 → oee_calculations 에 저장
                                          ↓
                              대시보드가 이 표만 읽는다
```

구성 요소와 실제:

| 계획 | 실제 |
|---|---|
| `pg_cron` 으로 매일 08:30 / 20:30 자동 실행 | 확장 미설치 — **한 번도 실행된 적 없음** |
| `supabase/migrations/20241211000000_setup_daily_oee_cron.sql` | 저장소에 **없음** (git 히스토리 전체에도 없음) |
| `oee_aggregation_log` 가 실행 이력 기록 | 그런 테이블 **없음** |
| `oee_calculations` 가 결과 저장 | 2026-08-06 **제거** — 행 0개로 한 번도 채워진 적 없다 |
| `OEEAggregationService` / `OEEAggregationManager` | 어디서도 import·마운트되지 않은 **죽은 코드** |

**무엇이 대신하고 있나**

1. **`analytics_*` RPC** (2026-07-13 도입) — 집계를 SQL 안에서 그때그때 계산한다.
   `analytics_oee_daily`, `analytics_oee_by_machine`, `analytics_oee_records_summary`,
   `analytics_productivity`, `analytics_quality`.
2. **`production_records` 의 교대별 OEE 스냅샷** — 확정 시점의 지표가 행에 함께 저장된다.

미리계산 층이 필요 없어졌다. `CLAUDE.md` 가 정한 규칙("Node 에서 집계하지 말고 SQL 에서
집계하라")이 곧 이 설계 교체의 결론이다.

`oee_calculations` 제거 근거와 되살릴 때의 정의는
`supabase/migrations/20260804140000_drop_oee_calculations.sql` 주석에 남겼다.
