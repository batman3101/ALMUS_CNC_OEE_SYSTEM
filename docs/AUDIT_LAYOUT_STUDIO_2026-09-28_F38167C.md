---
title: Layout Studio 재감사 — f38167c
description: 새 계획과 이전 셋업의 목표 충돌 및 확정·완료 잠금 교착, 운영 DB와 테스트 검증
tags:
  - audit
  - layout-studio
  - supabase
audited_commit: f38167caf7f43b5e621deed0e440470283087847
audit_date: 2026-09-28
verdict: REQUEST CHANGES
---
# Layout Studio 브랜치 재감사 보고서

## 1. 결론

**수정 필요: 높음 1건, 중간 1건.**

이전 감사의 수요 오류·필수 공정 누락·연결 해제·CAPA 0 문제는 보완되었다. 운영 마이그레이션 이력도 원장과 일치한다. 다만 설비 변경 시점이 계획 확정에서 셋업 완료로 이동하면서, 이전 셋업과 새 확정 계획의 목표 충돌 및 잠금 순서 역전이 남아 있다.

| 항목 | 기준 |
| --- | --- |
| 감사일 | 2026-09-28, Asia/Bangkok |
| 브랜치 | feat/layout-studio-claude |
| 감사 HEAD | f38167caf7f43b5e621deed0e440470283087847 |
| 최신 비교 기준 | origin/main, b813cbba6d9a02796902243d291d022b91941e43 |
| 비교 방법 | origin/main...HEAD, 원격 main fetch 후 재확인 |
| 변경량 | 142개 파일, 17,039줄 추가·84줄 삭제 |
| 주요 범위 | Forecast → 수요·CAPA·추천 → Layout 저장·확정 → 셋업 완료·설비 반영 |
| 운영 DB | CNC_OEE / wmtkkefsorrdlzprhlpr |
| 산출물 | 본 보고서만 추가, 소스·운영 DB 수정·배포·커밋 없음 |

시작 시 미추적 항목은 `.bkit/`, `.serena/`, [이전 교대 마감 감사 보고서](./AUDIT_CLOSE_QUEUE_DEFECT_2026-09-28.md)였다. 모두 보존했다. [이전 Layout 감사 보고서](./AUDIT_LAYOUT_STUDIO_2026-09-28_CODEX.md)의 a8eb9da 결과는 비교 자료이며 이번 실행 결과와 구분한다.

## 2. 증거와 검증 범위

- 소스·운영 함수 확인: 실제 저장소 코드 및 Supabase 읽기 전용 조회.
- 로컬 DB 재현: 기존 로컬 Supabase PostgreSQL에서 트랜잭션으로 검증하고 전부 롤백. 운영에 쓰지 않았다.
- 모의 실행: 실제 TypeScript 어댑터를 메모리에서 로드하여 합성 입력으로 결과 확인.
- 브라우저: 실제 앱을 로컬 프로덕션 서버에서 실행하되 인증·API·Supabase는 모의 처리. 외부 서비스 요청 차단.
- 운영 조회 시점에는 ALT·ALV 모두 확정 계획 0건, 미완료 셋업 0건이었다. 아래 문제로 운영 피해가 이미 발생했다는 증거는 없다.

## 3. 발견 사항

| ID | 심각도 | 문제 | 확인 수준 |
| --- | --- | --- | --- |
| F-01 | 높음 | 새 계획이 유지하는 설비를 이전 계획의 미완료 셋업이 나중에 변경 | 로컬 실제 RPC 순차 호출·롤백 + 운영 함수 확인 |
| F-02 | 중간 | 계획 확정과 셋업 완료의 잠금 순서 역전으로 교착 | 로컬 PostgreSQL 두 세션의 동일 잠금 순서 재현 + 운영 함수 확인 |

### F-01 — 이전 셋업 완료가 새 확정 계획을 위반

**신뢰도: 높음.** 설비 변경을 셋업 완료 때 적용하도록 바꾼 뒤의 계획 간 정합성 문제다.

[셋업 완료 반영 마이그레이션](../supabase/migrations/20260928140000_layout_setup_completion_applies.sql)의 확정 함수는 85~119행에서 `final != base`인 설비만 순회한다. 해당 설비의 과거 미완료 작업만 취소한다. 122행 이후에는 이전 확정 계획 전체를 superseded로 바꾼다. 따라서 새 계획이 그대로 유지하는 설비의 옛 작업은 살아남는다.

같은 파일의 완료 함수는 188~209행에서 설비가 before 또는 target인지 검사하지만, **현재 확정 계획의 final 배정과 옛 작업 target이 일치하는지 검사하지 않는다.** 운영 함수 정의에서도 이 제어 흐름을 확인했다.

#### 재현

로컬 DB의 실제 `create_layout_plan`, `confirm_layout_plan`, `transition_machine_setup_task`를 호출했다. 변경은 하나의 트랜잭션 안에서 수행하고 마지막에 ROLLBACK했다.

| 순서 | 상태·행동 |
| --- | --- |
| 1 | 실제 설비 M은 A 공정 배정 |
| 2 | P1을 A → B로 생성·확정하고 해당 셋업 시작 |
| 3 | 셋업 완료 전 P2를 생성. 실제 상태 A를 그대로 유지하도록 확정 |
| 4 | P1은 superseded, P2는 confirmed. P1 작업은 in_progress로 남음 |
| 5 | P1 작업 완료 호출 |
| 6 | 완료 성공·machine_applied=true. 실제 설비는 B, P2의 확정 목표는 A |

실행 출력 핵심:

```text
P1 status=superseded, old task status=in_progress, P2 status=confirmed
old task complete: status=completed, revision=3, machine_applied=true
actual_matches_confirmed_plan=false
ROLLBACK
```

감사 종료 전 `AUDIT rollback%` 제목의 로컬 계획 수가 0임을 확인했다.

#### 화면 영향

[계획 조회](../src/lib/layout-planning/server.ts)는 선택한 계획의 작업뿐 아니라 공장 전체의 미완료 작업도 반환한다. [planAdapter.ts](../src/components/layout-studio/planAdapter.ts)는 이전 작업을 `previousPlan: true`로 표시하면서도 실행할 작업 ID를 제공한다. [LayoutStudio.tsx](../src/components/layout-studio/LayoutStudio.tsx)의 transition은 그 ID로 완료 API를 호출한다. 이전 작업 표시 자체는 과거 조회 누락의 수정이지만, 새 계획 목표와 충돌하는 작업을 실행하지 못하도록 보호하지는 않는다.

실제 어댑터에 합성 입력을 준 결과 P2의 A 공정 CAPA는 `assigned=1, required=1, status=ok`인데 동시에 실행 가능한 이전 작업의 목표는 B였다. 완료 후 실제 설비가 B인 스냅샷을 다시 넣어도 CAPA는 계획의 A 배정으로 계산되었다. 이는 계획상 CAPA가 실제 완료 결과를 보증하지 못한다는 뜻이다.

#### 권고와 완료 기준

새 계획 확정 시 유지 설비를 포함한 모든 미완료 작업을 새 목표와 대조해야 한다. 목표가 다른 이전 작업은 명시적으로 취소·대체하거나 새 계획 확정을 충돌로 거절하는 계약이 필요하다. 완료 함수에도 현재 유효 목표에 대한 보호를 고려한다.

P1(A→B) 미완료 상태에서 P2(A 유지)를 확정한 뒤 P1을 완료해도 P2와 모순되는 변경이 발생하지 않아야 한다. 같은 목표를 계승하는 작업은 별도 정상 경로로 검증한다.

### F-02 — 확정·완료 동시 실행의 잠금 순서 역전

**신뢰도: 높음.** 데이터가 일부 커밋되는 문제라기보다 정상 업무 요청 중 한쪽이 교착 희생자로 실패할 수 있는 가용성 문제다.

[같은 마이그레이션](../supabase/migrations/20260928140000_layout_setup_completion_applies.sql)의 잠금 순서는 다음과 같다.

| 경로 | 먼저 획득 | 나중에 획득 |
| --- | --- | --- |
| confirm_layout_plan | 65~71행: machines FOR SHARE | 102~106행: 이전 machine_setup_tasks UPDATE |
| transition_machine_setup_task 완료 | 160행 설비 advisory, 164~167행: 작업 FOR UPDATE | 182~185행: machines FOR UPDATE |

확정은 설비 행을 잡고 작업을 기다리며, 완료는 작업 행을 잡고 설비를 기다릴 수 있다. 확정 경로가 동일 설비 advisory 잠금을 먼저 얻지 않으므로 완료 경로의 advisory만으로 이 경합을 막지 못한다. 운영 함수에서도 동일 순서를 확인했다.

#### 재현

로컬 DB에서 동일 설비와 관련 작업 행을 대상으로 두 세션에서 SELECT 잠금만 획득했다. 실제 RPC 전체를 동시에 호출한 재현은 아니며, 함수가 사용하는 잠금 순서를 그대로 축소한 검증이다.

```text
세션 A: BEGIN → machine FOR SHARE → 대기 → task FOR UPDATE
세션 B: BEGIN → task FOR UPDATE → machine FOR UPDATE
결과: ERROR: deadlock detected
       while locking tuple in relation "machine_setup_tasks"
```

한 세션은 PostgreSQL 교착 오류로 중단되었고 다른 세션은 ROLLBACK했다. 이 검증은 데이터를 갱신하지 않았다.

[server.ts](../src/lib/layout-planning/server.ts)의 오류 매핑에는 교착 코드 40P01을 위한 재시도·409 변환이 없다. 이 경합은 일반 500 응답으로 이어질 수 있다.

#### 권고와 완료 기준

계획 확정과 셋업 완료에서 설비·작업 잠금의 획득 순서를 통일한다. 다중 설비 작업은 정렬 순서까지 고정하고, 교착·직렬화 실패에 대한 제한적 재시도 또는 명확한 충돌 응답도 검토한다.

새 계획 확정과 이전 셋업 완료를 실제 두 DB 세션에서 경합시켜, 교착 없이 완료하거나 예측 가능한 충돌로 종료됨을 확인해야 한다. 이번 잠금 축소 재현만으로 수정 후 RPC 전체의 동시성 검증을 대체하면 안 된다.

## 4. 이전 발견 사항의 재확인

| 이전 ID | 이번 확인 |
| --- | --- |
| BUG-01 오류 수요를 0으로 처리해 방출 | unreadable demand 방출 차단 및 warnings 저장 보완. 관련 회귀 테스트 통과 |
| BUG-02 유지 설비의 동시 변경 누락 | 확정 때 모든 계획 설비 FOR SHARE 확인. 다만 새 완료 경로와 F-02 잠금 충돌 존재 |
| BUG-03 필수 공정 누락 | missingProcesses 보존·422 확인·경고 행 추가. 관련 테스트 통과 |
| BUG-04 과거 미완료 작업 조회 누락 | 공장 전체 미완료 작업을 조회하고 이전 계획 표시. 새 완료 의미에서는 F-01 추가 보호 필요 |
| BUG-05 모델명 연결 해제 누락 | mappingItemsToSave가 기존 연결 해제를 null로 전달. 테스트 통과 |
| BUG-06 CAPA 0의 Infinity | dailyCapacityPerMachine이 null 반환. 경계 회귀 테스트 통과 |
| DB-01 과거 version 차이 4건 | 이번 운영 이력과 원장에서 차이 없음 |

근거: [auditFixes.test.ts](../src/lib/layout-planning/__tests__/auditFixes.test.ts), [requiredMachines.ts](../src/lib/forecast/requiredMachines.ts), [planInput.ts](../src/lib/layout-planning/planInput.ts), [연결 저장 변환](../src/components/forecast/layoutPlanMappings.ts), [서버 조회](../src/lib/layout-planning/server.ts), [감사 보정 SQL](../supabase/migrations/20260928110000_layout_planning_audit_fixes.sql).

위 표는 이전 재현 조건에 대한 코드·테스트 재확인이다. 기능 전체의 모든 경계가 해결되었다는 포괄적 승인으로 해석하지 않는다.

## 5. 운영 DB·마이그레이션

[적용 원장](../supabase/applied-migrations.json)과 새로 조회한 운영 `list_migrations` 결과는 **각 123건, 이름·버전 차이 0건**이다. [검사 스크립트](../scripts/check-migrations.mjs)의 로컬 검사도 SQL 92개 중 적용 대응 91, 의도적 제외 1, 미적용 0, 해시 드리프트 0이었다.

| Layout 변경 | 운영 version |
| --- | --- |
| layout_planning_tables | 20260928003806 |
| layout_planning_rpcs | 20260928003907 |
| layout_geometry_alt_w39 | 20260928004155 |
| layout_plan_half_assignment | 20260928005906 |
| layout_planning_audit_fixes | 20260928013937 |
| layout_walkways | 20260928055250 |
| layout_setup_completion_applies | 20260928071500 |
| layout_geometry_alv | 20260928080456 |

운영 카탈로그·집계 SELECT 결과:

| 공장 | 활성 설비 | 활성 도면 | 활성 도면 위치 | 확정 계획 | 미완료 셋업 |
| --- | ---: | ---: | ---: | ---: | ---: |
| ALT | 800 | 1 | 800 | 0 | 0 |
| ALV | 350 | 1 | 350 | 0 | 0 |

- Layout 관련 8개 테이블의 RLS 활성화, anon SELECT 불가, authenticated INSERT 불가를 확인했다.
- confirm_layout_plan·transition_machine_setup_task의 운영 정의에서 이번 셋업 완료 반영 로직과 잠금 순서를 확인했다. 두 함수의 anon·authenticated EXECUTE는 false였다.
- ALV 도면은 이전 감사와 달리 운영에 등록되어 있다.
- 적용 이력·원장 해시 일치는 운영 전체 스키마·데이터의 완전한 동일성 증명이 아니다. 실제 역할 JWT CRUD 및 모든 정책의 우회 가능성을 전수 검증하지 않았다.

## 6. 실행 검증

아래 결과는 이번 HEAD 감사에서 새로 실행했다.

| 검증 | 결과 |
| --- | --- |
| npm run lint | 종료 0, 오류 0·경고 19 |
| npx tsc --noEmit --incremental false | 종료 0 |
| Jest: --runInBand --roots src supabase --watchman=false --silent | 173 suites 통과, 1,443 tests 통과·2 skipped, 234.898초 |
| 실파일 추가 Jest | FORECAST_SAMPLE_PATH 지정 후 parseForecast·weeklyDemand 2 suites, 26 tests 모두 통과 |
| npm run build | 종료 0, Next.js 16.3.0 Webpack, 정적 페이지 41개 |
| npm run check:migrations | 미적용 0·드리프트 0 |
| git diff --check origin/main...HEAD 및 git diff --check | 통과 |
| Layout 브라우저 검증 | 31개 모의 시나리오 통과 |
| F-01 | 실제 로컬 RPC 재현, 전부 롤백 |
| F-02 | 로컬 두 세션 잠금 순서 축소 재현, deadlock detected |

전체 실행에서 건너뛴 2건은 샘플 경로 환경 변수에 의존하는 실파일 테스트다. 추가 실행 26건에는 이미 통과한 24건도 포함되므로 1,443에 26을 더해 중복 집계하지 않는다. 이번 검증을 합쳐 최초 실행의 1,445개 테스트 항목 모두 통과 근거를 확보했다.

브라우저는 [검증 스크립트](../scripts/verify-layout-studio-browser.cjs)를 메모리에서 로드하되 산출물 경로만 임시 디렉터리로 바꿨다. 추적된 미리보기 이미지를 덮어쓰지 않았다. 저장·되돌리기·409·확정·셋업 시작/완료·셋업 충돌·작업판·폐기·언어·모바일·역할별 접근 등을 확인했다.

브라우저 테스트의 “도면 없는 ALV”는 모의 응답 조건이다. 실제 ALV에 도면이 없다는 의미가 아니며 위 운영 조회 결과를 우선한다.

```text
브라우저 임시 결과:
C:\Users\USER\AppData\Local\Temp\layout-audit-f38167c-sgw8Lr\verification.json
```

임시 파일은 장기 보존을 보장하지 않는다. 감사용 서버 127.0.0.1:3117은 브라우저 검증 후 종료했다. 기존 로컬 Supabase 컨테이너와 사용자 개발 서버는 종료하지 않았다.

## 7. 한계 및 후속 검증

- 운영 계획 생성·확정·셋업 완료·동시 쓰기는 실행하지 않았다.
- 브라우저 통과는 모의 인증·API 증거이며 운영 종단 간 정상 동작을 보증하지 않는다.
- F-02는 동일 잠금 순서의 축소 재현이다. 실제 RPC 다중 세션 경합은 수정 후 추가 검증해야 한다.
- 기존 로컬 E2E 스크립트는 DB 시드를 삭제·재작성하므로 그대로 실행하지 않았다. 대신 F-01만 실제 함수와 롤백 트랜잭션으로 검증했다.
- 실제 배포가 이 HEAD를 서비스하는지, 물리 터치 기기 동작은 확인하지 않았다.
- 독립 심사자의 승인 결과는 없으며 이 문서는 실행 근거와 발견 사항을 기록한다.

후속 작업은 F-01 목표 충돌 계약과 F-02 잠금 순서를 수정하고 해당 조건을 회귀 테스트로 고정하는 것이다. 기존 자동 테스트와 브라우저 통과만으로 두 결함의 해소를 판정하지 않는다.

## 8. 최종 상태 확인 시 발견한 병행 변경

보고서 작성 후 최종 git status에서 아래 4개 추적 파일의 미커밋 변경이 새로 관찰되었다. HEAD는 f38167c 그대로다. 이 감사에서 작성하거나 되돌린 변경은 아니다.

- `src/components/layout-studio/studioEngine.js`
- `src/components/layout-studio/layout-studio.css`
- `scripts/verify-layout-studio-browser.cjs`
- `docs/previews/layout-studio-app/overview.png`

확인한 diff는 읽기 전용 화면의 배정 현황 패널 추가와 관련 검증·이미지 변경이다. F-01·F-02의 SQL 및 서버 경로는 이 변경 목록에 포함되지 않는다. 위 빌드·브라우저 31건 통과를 이 후속 미커밋 변경의 검증 결과로 확대하지 않는다. 본 보고서의 실행 판정은 f38167c 기준이며 후속 변경까지 포함한 작업 트리 전체의 재승인은 하지 않았다. 병행 변경은 그대로 보존했다.
