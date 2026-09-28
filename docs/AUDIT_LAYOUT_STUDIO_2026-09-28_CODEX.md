---
title: "Layout Studio 현재 브랜치 감사 보고서 — 2026-09-28"
description: "a8eb9da 기준 워크플로우·DB·마이그레이션·버그 재감사 결과와 검증 한계"
tags: [audit, layout-studio, forecast, supabase]
audit_date: "2026-09-28"
branch: "feat/layout-studio-claude"
audited_commit: "a8eb9da6ec533d9195a6ed5858c1dda7b3ec8560"
verdict: "REQUEST CHANGES"
---

# Layout Studio 현재 브랜치 감사 보고서

## 1. 판정과 범위

**판정: REQUEST CHANGES — 수정 필요.**

기본 워크플로우의 자동 검증은 통과했지만, 오류 수요의 재배정, 확정 시 동시 변경 검사, 필수 공정 경고 누락 등 6건의 결함이 남아 있다. 신규 마이그레이션 4개는 운영 적용을 확인했다. 기존 적용 원장의 버전 번호 불일치 4건은 신규 버그와 분리한다.

| 항목 | 감사 기준 |
| --- | --- |
| 감사일 | 2026-09-28, Asia/Bangkok |
| 브랜치 | feat/layout-studio-claude |
| HEAD | a8eb9da6ec533d9195a6ed5858c1dda7b3ec8560 |
| origin/main | 3fa9b19fdbcf38d486b41bb54fd5d5c3ff81ee11 |
| 비교 | origin/main...HEAD, 변경 파일 124개 |
| 주요 범위 | Forecast 파싱·주간 수요·CAPA·추천, Layout 생성·수정·확정·셋업, 관련 API·DB·권한·마이그레이션 |
| 운영 DB | CNC_OEE / wmtkkefsorrdlzprhlpr |
| 작업 방식 | 코드·운영 DB 읽기 전용, 메모리 내 재현, 로컬 테스트·빌드, 모의 API 브라우저 검증 |
| 시작·종료 상태 | 기존 미추적 .bkit/, .serena/ 보존, 감사 중 추적 파일 변경 없음 |

사용자가 업데이트 후 재감사를 요청하여 위 HEAD를 기준으로 처음부터 점검했다. 중단 전 감사에서 발견했던 반쪽 배정 제약 문제와 신규 원장 미갱신은 이번 판정에 재사용하지 않았다. 보고서 작성 시에도 HEAD가 같음을 확인했다.

범위는 브랜치 변경과 관련 경로이며, 모든 기존 기능이나 운영 배포 전체의 무결성을 보증하는 전수 감사는 아니다. 아래 결과는 해당 감사 시점의 관측이다.

### 증거 구분

- **직접 재현:** 현재 소스 함수를 메모리에서 실행해 결과를 확인.
- **코드·배포 함수 확인:** 저장소와 실제 운영 함수 정의를 대조. 장애 발생 가능성은 해당 제어 흐름에 따른 판단이며 운영 쓰기 재현과 구분.
- **운영 조회:** 카탈로그·적용 이력·집계 상태를 SELECT로 확인.
- **모의 브라우저 검증:** 실제 UI를 실행하되 인증·API·Supabase를 모의 처리. 운영 쓰기 검증이 아님.

## 2. 발견 사항 요약

| ID | 심각도 | 발견 사항 | 증거 |
| --- | --- | --- | --- |
| BUG-01 | 높음 | Forecast 오류 수요를 수요 0으로 처리해 설비를 재배정 | 직접 재현 |
| BUG-02 | 높음 | 확정 시 유지 대상 설비의 동시 변경을 완전히 차단하지 못함 | 코드·운영 RPC 일치 확인 |
| BUG-03 | 중간 | 필수 공정이 없으면 Layout 계획에서 경고 행 자체가 사라짐 | 직접 재현 |
| BUG-04 | 중간 | 이전 계획의 미완료 셋업이 일반 조회 동선에서 누락 | 코드·운영 RPC 확인 |
| BUG-05 | 중간 | 저장된 모델명 연결의 해제가 서버 요청에서 빠짐 | 실제 저장 함수 직접 재현 |
| BUG-06 | 중간·경계값 | CAPA 0에서 필요 설비 수가 Infinity, 직렬화 후 null | 직접 재현 |
| DB-01 | 기존 기록 불일치 | 적용 원장 4건의 version이 실제 DB와 다름 | 운영 조회·origin/main 대조 |

## 3. 버그 상세

### BUG-01 — 오류 수요가 수요 0으로 바뀌어 재배정 대상이 됨

**심각도: 높음 / 신뢰도: 높음.**

[weeklyDemand.ts](../src/lib/forecast/weeklyDemand.ts) 54~68행은 오류 셀을 합계에서 제외하고, 유효 숫자가 없으면 최대 수요를 0으로 반환한다. 경고는 붙지만 [requiredMachines.ts](../src/lib/forecast/requiredMachines.ts) 61~65행에서 수요 0인 행을 zero_demand로 분류한다. [recommendLayout.ts](../src/lib/layout-planning/recommendLayout.ts)의 후보 구성은 경고를 차단 조건으로 사용하지 않는다.

**재현:** 모델 A의 선택 주 수요를 오류 셀 1개만으로 구성하고, 모델 B에는 수요 100개를 주었다. A에 CNC1·CNC2 설비를 1대씩 배정한 뒤 현재 buildPlanDraft를 실행했다.

~~~json
{
  "modelA": {
    "peakQuantity": 0,
    "numericDays": 0,
    "errorCells": 1,
    "warnings": ["error_cells", "partial_week", "no_numeric"]
  },
  "recommendedMoves": [
    { "machine": "m1", "target": "B/CNC1", "reason": "zero_demand_release" },
    { "machine": "m2", "target": "B/CNC2", "reason": "zero_demand_release" }
  ],
  "storedRequirementsContainWarnings": false
}
~~~

[planInput.ts](../src/lib/layout-planning/planInput.ts) 104~110행의 저장 payload에는 warnings가 없다. 즉 Forecast에서 보였던 오류 정보도 저장된 Layout 요구량에 남지 않는다.

**영향:** 실제 수요를 알 수 없는 모델의 생산 능력을 다른 모델로 넘기는 추천을 만들고 확정할 수 있다.

**재검증 기준:** 오류·수식 캐시 누락 등으로 수요가 불명확한 모델이 자동 방출 후보가 되지 않고, Layout에서도 불확실성이 보존되는지 확인.

### BUG-02 — 유지 대상 설비는 확정 검사와 완료 사이에 바뀔 수 있음

**심각도: 높음 / 코드 판단 신뢰도: 높음 / 실제 동시 실행: 미검증.**

[확정 RPC](../supabase/migrations/20260925110000_layout_planning_rpcs.sql) 272~281행은 모든 배정의 기준값을 조회하지만 해당 조회에 설비 행 잠금이 없다. 284~292행은 최종 배정이 달라지는 설비만 순회하며 apply_layout_machine_assignment 내부의 잠금·재검사를 수행한다.

가능한 실행 순서는 다음과 같다.

1. 계획 P가 유지 대상 설비 M의 기준 배정이 동일함을 확인.
2. 별도 요청이 M의 모델·공정 또는 활성 상태를 변경하고 커밋.
3. P는 변경 대상 설비만 잠금·반영하고 confirmed로 완료.
4. 확정 계획의 CAPA 계산 전제와 실제 유지 대상 설비 상태가 달라짐.

실제 운영 confirm_layout_plan 함수 본문은 저장소와 일치했다. 변경 대상 설비에 대한 잠금·기준 비교는 존재하므로, 이 결함은 그 보호가 적용되지 않는 **유지 대상**에 관한 것이다.

**영향:** CAPA 전제가 바뀐 계획이 정상 확정으로 기록될 수 있다.

**재검증 기준:** 별도 세션으로 유지 대상 설비를 변경하는 경합에서 계획이 일관된 기준을 유지하거나 충돌로 거절되는지 확인. 이번 감사에서는 운영 동시 쓰기를 실행하지 않았다.

### BUG-03 — 누락된 필수 공정의 경고가 계획 저장에서 제거됨

**심각도: 중간 / 신뢰도: 높음.**

[requiredMachines.ts](../src/lib/forecast/requiredMachines.ts)에서 CNC1·CNC2는 기본 요구 공정이다. 공정이 없으면 no_tact 행을 만든다. 그러나 [planInput.ts](../src/lib/layout-planning/planInput.ts) 105행은 processId가 없는 행을 저장 요구량에서 제거한다.

**재현:** CNC1만 등록된 모델 B에 수요 100개를 넣었다.

| 단계 | 결과 |
| --- | --- |
| Forecast 계산 | CNC1: shortage / CNC2: no_tact |
| 저장할 Layout 요구량 | CNC1 행만 존재 |
| 미해결 목록 | CNC1 부족만 포함 |

**영향:** Layout에서는 CNC2 미등록 문제를 요구량·CAPA 경고로 볼 수 없다. 등록된 공정만 충족시키면 전체 준비 상태를 과대평가할 수 있다. 선택 공정인 CNC0의 제외와는 별개의 문제다.

**재검증 기준:** 필수 공정 미등록을 계획 생성 단계에서 명확히 거절하거나, 계획과 화면에 별도 미해결 항목으로 보존하는지 확인.

### BUG-04 — 이전 계획의 미완료 셋업이 일반 조회 동선에서 누락됨

**심각도: 중간 / 신뢰도: 높음 / 운영 쓰기 재현: 미실시.**

[확정 RPC](../supabase/migrations/20260925110000_layout_planning_rpcs.sql) 295~307행은 이번 계획에서 배정을 바꾸는 설비의 이전 셋업만 취소한다. 327~330행은 이전 확정 계획 전체를 superseded로 바꾼다.

[server.ts](../src/lib/layout-planning/server.ts) 102행은 계획 선택 목록을 draft·confirmed로 제한하고, 184행은 셋업을 선택한 plan_id로만 조회한다. [LayoutStudio.tsx](../src/components/layout-studio/LayoutStudio.tsx) 67~68행과 계획 선택 UI가 이 목록을 사용한다.

**발생 조건:** P1에서 설비 M을 변경해 pending 셋업을 만든 뒤, M의 배정을 유지하는 P2를 확정한다.

**결과:** M의 미완료 셋업은 P1에 남지만 P1은 일반 선택 목록에서 빠지고 P2 셋업에는 포함되지 않는다. 이전 계획 URL을 알고 있으면 접근할 수 있으므로 데이터 삭제나 완전한 접근 불능으로 판단하지 않는다.

**영향:** 미완료 현장 작업이 현재 계획 화면에서 누락될 수 있다.

**재검증 기준:** 새 확정 후에도 공장 내 남아 있는 미완료 셋업이 조회·처리 가능한지 확인.

### BUG-05 — 모델명 연결 해제가 저장 요청에서 제외됨

**심각도: 중간 / 신뢰도: 높음.**

[LayoutPlanLauncher.tsx](../src/components/forecast/LayoutPlanLauncher.tsx) 58행은 productModelId가 있는 행만 저장 요청에 포함한다. 반면 [server.ts](../src/lib/layout-planning/server.ts)의 saveMappings는 productModelId가 null인 항목을 받아야 기존 연결을 삭제한다.

현재 소스에서 saveMappings 함수를 추출하여 네트워크를 모의 처리하고 실행했다.

~~~json
{
  "clearedSavedMapping": "AliasA",
  "sent": { "items": [] },
  "created": true,
  "removalSent": false
}
~~~

**영향:** 사용자는 연결을 지웠다고 생각하지만 서버에는 이전 연결이 남고, 이후 계획 생성에서 다시 사용될 수 있다.

**재검증 기준:** 기존 연결을 clear 후 저장했을 때 삭제 항목이 서버로 전달되고, 재조회·계획 생성에서도 이전 연결이 사용되지 않는지 확인.

### BUG-06 — 일 CAPA가 0이면 필요 설비 수가 Infinity로 계산됨

**심각도: 중간·경계값 / 신뢰도: 높음.**

[capacityPolicy.ts](../src/lib/forecast/capacityPolicy.ts) 11행은 휴식시간을 0~1440분 범위로 검사한다. [requiredMachines.ts](../src/lib/forecast/requiredMachines.ts) 38~42행은 720분 교대 2회의 CAPA를 계산하며, 62행은 CAPA가 0인 경우를 나누기 전에 처리하지 않는다.

**재현:** T/T 60초, 교대별 휴식 720분, 수요 100개 조건.

| 항목 | 결과 |
| --- | --- |
| daily_capacity_per_machine | 0 |
| 메모리 내 required_machines | Infinity |
| JSON 직렬화 후 required_machines | null |

**영향:** 화면 계산과 저장값의 의미가 달라지고, 계산 불능과 무한 부족을 일관되게 표현하지 못한다. 이 조건이 현재 운영 설정이라는 주장은 하지 않는다.

**재검증 기준:** CAPA 0·극단적으로 긴 T/T·가동시간을 소진하는 휴식 입력에서도 비유한 수를 생성하지 않는지 확인.

## 4. DB·마이그레이션 감사

### 4.1 신규 적용 상태

운영 supabase_migrations.schema_migrations와 로컬 적용 원장을 대조했다.

| 로컬 파일 | 운영 version | 운영 name |
| --- | --- | --- |
| 20260925100000_layout_planning_tables.sql | 20260928003806 | layout_planning_tables |
| 20260925110000_layout_planning_rpcs.sql | 20260928003907 | layout_planning_rpcs |
| 20260925120000_layout_geometry_alt_w39.sql | 20260928004155 | layout_geometry_alt_w39 |
| 20260928100000_layout_plan_half_assignment.sql | 20260928005906 | layout_plan_half_assignment |

근거 파일: [적용 원장](../supabase/applied-migrations.json), [테이블 마이그레이션](../supabase/migrations/20260925100000_layout_planning_tables.sql), [RPC 마이그레이션](../supabase/migrations/20260925110000_layout_planning_rpcs.sql), [도면 마이그레이션](../supabase/migrations/20260925120000_layout_geometry_alt_w39.sql), [반쪽 배정 보정](../supabase/migrations/20260928100000_layout_plan_half_assignment.sql).

npm run check:migrations 결과는 로컬 87개 중 적용 86개, 의도적 제외 1개, 미적용 0개, 드리프트 0개였다. 의도적 제외는 independent_downtime_lifecycle에 대체된 20260715120000_atomic_downtime_save다.

이 검사는 [check-migrations.mjs](../scripts/check-migrations.mjs)가 로컬 파일과 저장된 원장을 대조한 결과다. 그 자체가 실제 DB 전체의 스키마·함수·데이터 무결성 증명은 아니다.

### 4.2 운영 상태와 권한

운영 SELECT 조회의 집계 결과:

| 공장 | 활성 설비 | 활성 도면 | 도면 위치 | 반쪽 배정 활성 설비 | Layout 계획 |
| --- | ---: | ---: | ---: | ---: | ---: |
| ALT | 800 | 1 | 800 | 0 | 0 |
| ALV | 350 | 0 | 0 | 0 | 0 |

ALV 도면 미등록은 현재 지원 범위의 제약이다. 모의 브라우저에서 도면 없음 안내가 표시되는 것을 확인했다. 운영 계획이 0건이므로 기존 계획 데이터의 무결성을 실제 사례로 검증한 것은 아니다.

카탈로그 조회에서 확인한 내용:

- 신규 8개 테이블은 RLS 활성화, anon SELECT 불가, authenticated INSERT 불가.
- create_layout_plan, save_layout_plan_draft, confirm_layout_plan, transition_machine_setup_task는 anon·authenticated 직접 실행 불가, service_role 실행 가능.
- 내부 apply_layout_machine_assignment는 anon·authenticated·service_role 직접 실행 불가.
- create_layout_plan, confirm_layout_plan, transition_machine_setup_task의 운영 본문은 저장소 본문과 일치.
- 반쪽 배정 보정의 CHECK 변경이 실제 DB에 반영됨.

이는 조회한 권한·정의에 대한 확인이며 모든 역할의 실제 JWT CRUD 검증을 대신하지 않는다.

### 4.3 DB-01 — 기존 적용 원장의 version 불일치 4건

운영 이력과 로컬 원장 모두 118건이며 아래 4건은 name은 같지만 version이 다르다.

| name | 로컬 원장 version | 운영 DB version |
| --- | --- | --- |
| enforce_write_boundary | 20260729114500 | 20260729112818 |
| close_shift_source_completeness | 20260729120500 | 20260729113849 |
| settings_batch_update | 20260729124500 | 20260729115225 |
| revoke_public_execute_sweep | 20260729125500 | 20260729115450 |

근거: [applied-migrations.json](../supabase/applied-migrations.json) 414~428행과 운영 적용 이력 SELECT. origin/main의 같은 원장에서도 동일한 로컬 version을 확인했으므로 이번 브랜치가 만든 불일치가 아니다.

**판정:** 적용 이력 기록 불일치. 해당 마이그레이션 미적용 또는 실제 SQL 내용 드리프트로 단정하지 않는다. check:migrations는 name·별칭 중심 대조여서 이 version 차이를 잡지 않는다.

## 5. 실행 검증

아래는 이번 재감사에서 새로 실행한 결과다. 보고서 작성 때문에 검사를 다시 실행한 것은 아니다.

| 검사 | 명령·방법 | 결과 |
| --- | --- | --- |
| Lint | npm run lint | 성공, 오류 0·경고 19 |
| TypeScript | npx tsc --noEmit --incremental false | 성공 |
| 전체 src 테스트 | node node_modules/jest/bin/jest.js --runInBand --roots src --watchman=false | 156 suites 통과, 1230 tests 통과·2 skipped, 206.13초 |
| 프로덕션 빌드 | npm run build | 성공, 정적 페이지 41개 생성 |
| 마이그레이션 원장 | npm run check:migrations | 적용 86·제외 1·미적용 0·드리프트 0 |
| 변경 공백 검사 | git diff --check origin/main...HEAD 및 git diff --check | 성공 |
| 브라우저 | 기존 Layout Studio 검증 스크립트, 로컬 프로덕션 서버 | 25개 시나리오 통과 |
| 버그 재현 | 현재 TS 함수를 메모리 내 변환·실행, 요청 모의 처리 | BUG-01·03·05·06 재현 |

검증 명령의 기반은 [package.json](../package.json), [Jest 설정](../jest.config.js), [브라우저 검증 스크립트](../scripts/verify-layout-studio-browser.cjs)다.

브라우저 통과 범위에는 도면 800대·검색·이동·확대, 미세조정·잠금·되돌리기·저장·재조회, 409 충돌 안내, 확정 후 읽기 전용, 셋업 시작·완료·실패 처리, 360/390px 모바일, 한/베 전환, 다크모드, 관리자·엔지니어·작업자 접근, Forecast→매핑→계획 생성이 포함된다.

모든 브라우저 API·인증·Supabase는 모의 처리했고 외부 서비스 호출은 차단했다. 25개 시나리오 통과는 BUG-01~06의 경계·동시성 조건을 검증했다는 뜻이 아니다.

브라우저 결과물은 추적된 미리보기 파일을 덮어쓰지 않고 임시 디렉터리에 저장했다.

~~~text
C:\Users\USER\AppData\Local\Temp\cnc-oee-audit-NcyRlk\verification.json
~~~

이 경로는 해당 감사 환경의 임시 산출물이며 장기 보존을 보장하지 않는다. 보고서의 검증 표가 실행 결과 요약이다. 감사용 로컬 서버는 검증 후 종료했다.

## 6. 한계와 후속 검증 기준

- 운영 계획 생성·확정·셋업 전이·동시 쓰기는 실행하지 않았다.
- 실제 계정 JWT의 역할별 CRUD와 공장 간 격리 동작은 실행하지 않았다.
- 이번 재감사에서 DB 쓰기가 포함된 SQL 불변조건 테스트나 로컬 DB 시드 검증은 실행하지 않았다. 기존 커밋의 운영 L1–L11 PASS 문구를 이번 실행 결과로 계산하지 않았다.
- Vercel 등 실제 애플리케이션 배포가 이 HEAD를 서비스하는지 확인하지 않았다.
- 브라우저 다중 포인터는 합성 입력이며 물리 터치 기기 검증은 아니다.
- 독립 심사자의 승인 결과는 없으며 이 문서는 감사 발견 사항과 실행 근거를 기록한다.
- 코드·DB 수정, 마이그레이션 재적용, 커밋·푸시는 이번 감사와 보고서 작성 범위에서 수행하지 않았다.

재감사 시에는 BUG-01~06의 재현 조건을 회귀 검증하고, 동시성 문제는 격리된 DB의 다중 세션에서 별도로 검증해야 한다. 자동 검사 통과만으로 해당 결함의 해소나 운영 정상 동작을 판정하지 않는다.
