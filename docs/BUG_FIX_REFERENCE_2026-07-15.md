# CNC OEE 기능 버그 수정 참조서

## 문서 목적

이 문서는 2026-07-15 정적 재감사에서 확인한 기능 버그 16건과 수정·검증 결과를 후속 유지보수 기준으로 정리한 것이다. 최초 감사 기준은 `96df96a`이며, `bug-fix-codex-20260715-080308` 브랜치의 전체 수정 결과를 반영했다.

최초 발견은 코드 흐름을 근거로 한 정적 감사였고, 후속 재감사에서는 인증·권한, 현장 작업 흐름, 관리자 장기 분석 경로까지 범위를 넓혔다. 운영 DB 쓰기는 신규 migration을 먼저 적용해야 하므로 자동 수행하지 않았다.

## 최초 16건 상태 요약

| 상태 | 건수 | 항목 |
|---|---:|---|
| 해결됨 | 16 | BUG-001~016 |
| 미해결 | 0 | 최초 BUG-001~016 중 없음 |

상태 정의:

- `미해결`: 현재 코드에서도 원인이 남아 있음
- `부분 해결`: 일부 화면이나 데이터 경로는 수정됐지만 동일 원인의 다른 경로가 남아 있음
- `해결됨·회귀 방지 필요`: 현재 코드에서 원인은 제거됐으며 회귀 테스트 유지가 필요함

## 2026-07-15 최종 수정·검증 결과

- 16개 최초 항목과 후속 재감사에서 드러난 인증·비가동 lifecycle·OEE 완전성 문제에 회귀 테스트를 추가했다. 최종 로컬 검증은 Jest 51개 스위트·287개 테스트 통과, TypeScript 오류 0건, ESLint 오류 0건(기존 Hook 의존성 경고 14건), 프로덕션 빌드 통과다.
- 3개월 전체 설비 실제 데이터에서 OEE 원본 `142,822`건, 생산실적 `326,971`건을 확인했다.
- 원본 목록은 5,000건 단위 안정 정렬 페이지를 사용하며 첫 2페이지 10,000건에서 중복 ID 0건을 확인했다.
- 수동 비가동은 생산실적보다 먼저 시작하거나 생산실적 없이 지속될 수 있는 독립 사건으로 저장한다. 생산 저장·삭제·휴무 전환은 비가동 사건을 삭제하지 않는다.
- 브라우저 검증 기록은 `docs/qa/bug-fix-2026-07-15/BROWSER_VERIFICATION.md`를 참조한다.
- 기존 원자 저장 migration은 과거 이력으로 유지한다. 현재 운용 계약은 `20260715160000_independent_downtime_lifecycle.sql`, `20260715170000_oee_completeness_and_alert_acknowledgements.sql`, `20260715180000_active_admin_authorization.sql`, `20260715190000_active_user_audit_authorization.sql`에 후속 정의했으며, 네 파일은 main PR 병합 후 순서대로 적용하고 실제 저장 smoke test를 수행해야 한다.

## 후속 현장 운용·관리자 분석 감사

최초 16건을 닫은 뒤 사용자 작업 순서와 장기 분석 결과를 반복 감사했다. 마지막 독립 검증에서 배포 차단으로 분류된 P1 11건은 모두 코드 또는 migration과 회귀 테스트에 반영했다. 그 뒤 간접 Service Role fallback을 사용하는 시스템 설정 API도 추가로 찾아 인증·실제 데이터 계약으로 정리했다.

| 결과 | 항목 |
|---|---|
| 해결 | 리포트 OEE/생산 행의 배열 인덱스 결합 제거; `record_id`로 결합 |
| 해결 | 여러 설비를 선택해도 첫 설비만 조회하던 UI/API 계약을 단일 설비 선택으로 일치 |
| 해결 | 런타임 미보고 생산량을 생산 통계에서 버리던 문제 제거; OEE 보고 커버리지 별도 표시 |
| 해결 | 비활성 설비의 신규 생산·비가동 저장 차단 및 열려 있는 상태/비가동 구간 종료 migration 작성 |
| 해결 | 경고 확인 후 심각도가 warning에서 critical로 상승해도 숨겨지던 ID 충돌 제거 |
| 해결 | UTC 날짜 대신 설정된 시간대와 A교대 시작을 기준으로 B교대 영업일 계산 |
| 해결 | 장기 보고서 설비 목록에서 비활성 설비가 빠져 과거 실적이 누락되던 문제 제거 |
| 해결 | Service Role을 사용하는 상세 조회·분석 API의 인증·역할·운영자 설비 범위 검증 추가 |
| 해결 | 제품·공정 기준정보 및 시스템 설정의 Service Role 우회 경로에 서버 인증·역할·활성 계정 검증 추가; 목업 설정 성공 응답 제거 |
| 해결 | 새벽 B교대 입력을 회사 시간대의 전일 영업일/B교대로 초기화하고 DatePicker 시각도 회사 시간대로 저장 |
| 해결 | 비가동 사건 0건을 자동으로 무중단으로 간주하지 않음; 작업자의 명시적 0분 확인이 없으면 런타임/OEE를 `NULL`로 보존 |
| 해결 | 수량만 수정할 때 기존 미확정 runtime/OEE를 0 또는 기본 tact로 덮어쓰지 않음 |
| 해결 | OEE 보고 완료 기준에 planned/actual/ideal runtime과 공정 표준을 포함하고 무효·제외 레거시 건수를 관리자에게 표시; 미보고는 `NULL`, 모든 원본이 확정된 무생산 교대는 실제 OEE 0으로 구분 |
| 해결 | 음수 수량·불량 초과 등 invalid 행은 coverage에 남기되 전체·설비·교대·일별 생산/불량/양품 합계와 OEE에서 제외 |
| 해결 | migration 적용 전 이미 비활성인 설비의 열린 로그를 적용 시점에 종료하는 idempotent backfill 추가 |
| 해결 | Realtime INSERT/UPDATE/DELETE 시 필터 진입·이탈과 절단 목록을 서버 재조회·집계 건수로 보정; 과거 날짜 사후 INSERT도 서버 정렬 창을 유지 |
| 해결 | 현재 알림은 정확히 현재 영업일의 실제 현재 교대만 조회하고, 아직 시작하지 않은 교대의 사전 입력을 제외하며 동일 심각도 재발도 새 원본 사건 ID로 구분 |
| 해결 | 비활성 계정은 기존 토큰, 프로필 fallback, 직접 프로필 API, Service Role 설정 API, DB `is_admin()` 어느 경로에서도 관리자·사용자 세션으로 복구되지 않도록 차단 |
| 해결 | 설정 감사 테이블은 활성 admin·engineer만 조회하고 service role만 직접 기록; 감사 뷰에 `security_invoker`를 적용해 RLS 우회 차단 |
| 안전 차단 | DB에는 아직 실제 휴식 시작·종료 구간이 없다. `plannedStop`/`PLANNED_STOP`과 총 휴식시간의 겹침을 계산할 수 없는 교대는 중복 차감하지 않고 runtime/OEE를 `NULL`로 남긴다. 정확한 planned-stop OEE가 필요하면 후속으로 교대별 휴식 구간 설정을 추가해야 한다. |

따라서 이 문서의 `해결됨 16건`은 최초 BUG-001~016에 대한 판정이다. 운영 배포 전체가 무조건 안전하다는 뜻은 아니며, 신규 migration을 main PR 병합 후 적용한 뒤 인증 역할별 저장, B교대 자정 교차, 비가동 독립 저장, 무효 데이터 coverage를 실제 DB로 smoke test해야 한다.

## 권장 수정 순서

1. BUG-001: 운영자 입력 데이터의 OEE 0 저장
2. BUG-002: 원본 상세·내보내기·로그의 행 제한
3. BUG-003, BUG-015: 과거 OEE 스냅샷 및 가동시간 필드 일관성
4. BUG-004, BUG-007: 입력 화면의 비원자적 저장과 이전 상태 잔존
5. BUG-005, BUG-006: B교대 및 중첩 비가동 집계
6. BUG-008, BUG-009: 실시간 로그와 알림 상태 보존
7. BUG-011~016의 나머지 API·필터·검증 결함

---

## BUG-001 — 런타임 미확인 생산입력이 OEE 0으로 확정됨

- 심각도: Critical
- 현재 상태: 해결됨
- 영향: 실제 가동시간을 확인하지 않은 정상 생산 실적이 저성과 OEE 0으로 오인될 수 있음

원인:

- `useProductionRecords`는 생산량과 불량 수량만 전송한다.
- POST API가 누락된 `actual_runtime`을 0으로 처리했다.
- 확인되지 않은 런타임을 실제 0분과 구분하지 않아 관리자 통계를 왜곡했다.

근거 파일:

- `src/hooks/useProductionRecords.ts:6-35`
- `src/app/api/production-records/route.ts:175-240`

재현 조건:

1. 운영자 생산입력 화면에서 생산량이 0보다 큰 실적을 저장한다.
2. 요청에 `actual_runtime`과 `planned_runtime`이 없는지 확인한다.
3. 저장된 레코드의 availability, performance, OEE가 0인지 확인한다.

수정 완료 기준:

- 운영자 입력 경로가 서버가 계산할 수 있는 가동시간·비가동 정보를 제공한다.
- 런타임이 확인되지 않은 단건 입력은 `actual_runtime`, availability, performance, OEE를 `NULL`로 보존하며 0 또는 100으로 추정하지 않는다.
- 동일 입력값에 대해 일일 입력 API와 단건 생산입력 API의 OEE 결과가 동일하다.
- 생산량 양수, 불량 0, 가동시간 양수인 정상 입력이 OEE 0으로 저장되지 않는다.

필수 회귀 테스트:

- 런타임 필드가 누락된 요청의 불완전 지표 `NULL` 저장 테스트
- 생산량 0, 실제 가동시간 0, 정상 생산의 경계값 테스트

## BUG-002 — 대시보드·보고서 데이터가 행 제한에서 조용히 잘림

- 심각도: Critical
- 현재 상태: 해결됨
- 반영 커밋: `d82b1d8`
- 영향: 전체 통계와 상세 목록·내보내기·설비 로그가 서로 다른 데이터 범위를 보여줄 수 있음

현재 해결된 범위:

- Admin 전체·설비별·일별 OEE 통계
- Engineer 전체 OEE 통계
- 보고서에서 공통 훅을 통해 사용하는 전체 요약 통계
- DB 누적 시간·수량 기반 가중 OEE 집계

추가 해결된 범위:

- 보고서 상세 목록과 Excel/PDF/JSON 원본 내보내기
- `useRealtimeProductionRecords`가 제공하는 원본 레코드 목록
- `useRealtimeData`의 생산 기록 및 설비 로그
- 다운타임 분석에서 대량 원본 행을 읽는 경로

근거 파일:

- `supabase/config.toml:13`
- `src/hooks/useRealtimeProductionRecords.ts:12,116,197`
- `src/hooks/useRealtimeData.ts:13-29,164,327`
- `src/app/api/downtime-analysis/route.ts:89-133`
- `src/components/reports/ReportDashboard.tsx`
- `supabase/migrations/20260715080500_long_range_oee_aggregation.sql`

수정 완료 기준:

- 요약 통계는 원본 행 페이지 수와 무관하게 DB에서 계산한다.
- 상세 목록은 안정적인 정렬 키를 가진 cursor 또는 offset 페이지네이션을 사용한다.
- 내보내기는 모든 페이지를 서버에서 스트리밍하거나 비동기 파일로 생성한다.
- 응답에 `total`, `returned`, `has_more`가 있어 절삭을 숨기지 않는다.
- 800대, 2교대, 3개월 데이터에서 카드·차트·표·내보내기의 총량이 일치한다.

필수 회귀 테스트:

- 1,001건 및 50,001건 데이터셋의 요약·페이지네이션 테스트
- 페이지 경계에서 중복·누락이 없는 안정 정렬 테스트

## BUG-003 — 과거 기록 재저장 시 Tact/Cavity 스냅샷과 OEE가 모순됨

- 심각도: High
- 현재 상태: 해결됨
- 영향: 공정 조건 변경 후 과거 실적을 저장하면 스냅샷은 과거 값인데 계산 지표는 현재 값이 될 수 있음

원인:

- 일일 API는 현재 `machines_with_production_info`의 Tact/Cavity로 지표를 다시 계산한다.
- RPC의 conflict update는 기존 Tact/Cavity 스냅샷을 유지하면서 OEE 파생값은 새 계산값으로 덮어쓴다.

근거 파일:

- `src/app/api/production-records/daily/route.ts:164-213`
- `supabase/migrations/20260714120000_codex_round2_fixes.sql:90-118`
- 비교 기준: `src/app/api/production-records/[recordId]/route.ts:80-165`

수정 완료 기준:

- 과거 레코드 수정은 저장된 Tact/Cavity 스냅샷으로 OEE를 재계산한다.
- 스냅샷이 없는 레거시 데이터만 현재 공정값 또는 저장된 ideal runtime을 명시적 순서로 사용한다.
- 저장 후 `ideal_runtime = output × tact / cavity` 관계가 스냅샷과 일치한다.

필수 회귀 테스트:

- Tact/Cavity 변경 전후 과거 날짜 재저장 테스트
- 스냅샷이 없는 레거시 행의 fallback 테스트

## BUG-004 — 설비·날짜 변경 직후 이전 설비 수량이 저장될 수 있음

- 심각도: High
- 현재 상태: 해결됨
- 영향: 빠른 사용자 조작 또는 느린 네트워크에서 다른 설비·날짜에 이전 생산량이 저장될 수 있음

원인:

- 선택 변경 시 휴무·가동시간·비가동 목록은 초기화하지만 생산량·불량량·기존 레코드 상태는 조회 완료 전까지 남을 수 있다.
- 저장 버튼은 `loadingExistingRecords` 동안 비활성화되지 않는다.

근거 파일:

- `src/components/data-input/ShiftDataInputForm.tsx:377-410`
- `src/components/data-input/ShiftDataInputForm.tsx:886-920`
- `src/components/data-input/ShiftDataInputForm.tsx:1685-1700`

수정 완료 기준:

- 설비 또는 날짜 변경과 동시에 두 교대의 입력값과 기존 레코드 참조를 초기화한다.
- 기존 기록과 비가동 조회가 모두 끝날 때까지 저장을 차단한다.
- 오래된 비동기 응답은 최신 선택 상태를 덮지 못한다.

필수 회귀 테스트:

- 설비 A 조회 중 설비 B로 전환 후 즉시 저장 시도
- 날짜 연속 변경과 역순 응답 테스트

## BUG-005 — B교대 비가동의 자정 이후 구간이 누락되거나 과대 집계됨

- 심각도: High
- 현재 상태: 해결됨
- 영향: B교대 비가동 총시간, 일별 추세, 교대별 분석이 서로 다를 수 있음

현재 해결된 범위:

- `machine_logs`는 조회 범위 및 교대 시간창과 교집합을 계산한다.
- 교대를 넘는 상태 로그를 시작 교대에 전량 귀속하던 로직은 제거됐다.

추가로 해결한 원인:

- 단일 날짜 범위의 종료가 해당 달력일 `endOf('day')`여서 B교대의 다음 날 00:00~08:00을 포함하지 못할 수 있다.
- 수동 비가동은 잘린 `intervals`를 만들면서 요약 `duration`은 원본 `duration_minutes`를 사용한다.

근거 파일:

- `src/app/api/downtime-analysis/route.ts:75-105`
- `src/app/api/downtime-analysis/route.ts:340-445`
- `src/app/api/downtime-analysis/route.ts:588-635`

수정 완료 기준:

- 영업일 B교대의 종료 시각을 다음 날 08:00까지 포함한다.
- 요약·설비별·일별·시간대별 집계가 동일한 clipped interval 총량을 사용한다.
- A/B 교대 합계가 전체 기간 합계와 일치한다.

필수 회귀 테스트:

- 20:00~08:00, 23:30~01:30, 조회 범위 밖에서 시작한 진행 장애
- 단일 영업일, 연속 2일, 월말·연말 경계 테스트

## BUG-006 — 겹치는 수동 비가동이 이중 집계됨

- 심각도: High
- 현재 상태: 해결됨
- 영향: 실제 비가동보다 큰 총시간과 낮은 availability가 계산될 수 있음

원인:

- 수동 기록 구간은 machine log에서 중복을 뺄 때만 병합된다.
- `manualEntryRows` 자체는 각 행의 `duration_minutes`를 그대로 더한다.

근거 파일:

- `src/app/api/downtime-entries/route.ts:64`
- `src/app/api/downtime-analysis/route.ts:208-270`
- `src/app/api/downtime-analysis/route.ts:425-445`

수정 완료 기준:

- 같은 설비·교대에서 겹치는 수동 비가동 입력을 저장 시 거부하거나 집계 시 합집합으로 병합한다.
- 10:00~11:00과 10:30~11:30의 총 비가동은 90분이다.
- 원인별 시간이 필요하면 중첩 구간의 귀속 규칙을 명시한다.

필수 회귀 테스트:

- 완전 중첩, 부분 중첩, 맞닿은 구간, 서로 다른 설비·교대 테스트

## BUG-007 — 비가동 저장이 생산실적 존재에 종속됨

- 심각도: High
- 현재 상태: 해결됨
- 영향: 업무 시작 직후 또는 전일부터 계속된 비가동을 생산실적이 없다는 이유로 저장·유지·분석하지 못할 수 있음

원인:

- 생산실적과 비가동을 같은 lifecycle로 간주해 생산 실패·삭제·휴무 전환 시 비가동을 고아 데이터로 취급했다.
- 이 전제는 설비가 생산 전에 멈추거나 교대를 넘겨 계속 멈춰 있는 실제 현장 흐름과 맞지 않는다.

근거 파일:

- `src/components/data-input/ShiftDataInputForm.tsx:658-718`
- `src/app/api/downtime-entries/route.ts`
- 후속 migration은 열린 비가동(`end_time IS NULL`), ID 기반 수정, optimistic version, 설비별 동시 쓰기 직렬화를 제공한다.

수정 완료 기준:

- 비가동은 생산실적 없이 생성·조회·종료할 수 있다.
- 업무 시작 전 또는 전일에 시작한 열린 비가동을 현재 교대 시간창과 겹치는 만큼 집계한다.
- 생산 저장 실패, 생산 삭제, 휴무·비근무 전환은 이미 발생한 비가동을 삭제하지 않는다.
- 생산실적의 가동시간/OEE는 서버가 독립 비가동 사건의 교대 내 합집합을 계산할 수 있을 때만 확정한다. 조회 실패 시 생산 수량은 저장하되 파생 런타임/OEE는 `NULL`로 남긴다.

필수 회귀 테스트:

- 생산실적 0건 상태에서 비가동 생성·재조회·종료
- 전일 시작 후 `end_time IS NULL`인 비가동의 현재 교대 집계
- 비가동 저장 후 생산 저장 실패·브라우저 이탈·재진입
- 기존 비가동이 있는 교대를 휴무로 전환하거나 생산실적을 삭제해도 사건 보존
- 비가동 조회 실패 시 생산 수량 저장 및 런타임/OEE `NULL` 보존
- 중복 저장 거부, 버전 충돌 409, B교대 자정 교차 허용

## BUG-008 — 실시간 로그 INSERT 후 5,000건 상태가 100건으로 축소됨

- 심각도: High
- 현재 상태: 해결됨
- 영향: 다수 설비의 현재 상태 지속시간과 최근 로그가 첫 Realtime 이벤트 후 사라질 수 있음

원인:

- 최초 조회는 큰 로그 창을 유지하려 하지만 INSERT handler는 `slice(0, 99)`만 남긴다.

근거 파일:

- `src/hooks/useRealtimeData.ts:17-29`
- `src/hooks/useRealtimeData.ts:143-164`
- `src/hooks/useRealtimeData.ts:323-330`

수정 완료 기준:

- 초기 조회와 Realtime 보관 상한이 동일한 상수를 사용한다.
- 현재 열린 상태 로그는 최근 N건 제한과 별도로 모든 대상 설비에 대해 보존한다.
- 800대 설비에서 INSERT 후에도 각 설비의 열린 로그를 조회할 수 있다.

필수 회귀 테스트:

- 5,000건 초기 상태에 1건 INSERT 후 배열 크기와 열린 로그 보존 테스트

## BUG-009 — 알림 조회 실패 시 기존 활성 알림 전체가 사라짐

- 심각도: High
- 현재 상태: 해결됨
- 영향: 일시적인 네트워크 오류가 실제 장애 알림을 정상 복구처럼 숨길 수 있음

원인:

- `generateRealNotifications`는 오류를 빈 배열로 변환한다.
- `refreshNotifications`는 빈 배열을 성공 결과로 판단해 기존 알림을 교체한다.

근거 파일:

- `src/contexts/NotificationContext.tsx:145-250`
- `src/contexts/NotificationContext.tsx:252-270`

수정 완료 기준:

- 조회 실패와 정상적인 알림 0건을 구분한다.
- 실패 시 기존 활성 알림을 유지하고 stale/error 상태를 표시한다.
- 다음 성공 조회에서만 목록을 교체한다.

필수 회귀 테스트:

- 활성 알림 존재 상태에서 설비 API 500 및 네트워크 오류
- 다음 polling/realtime 성공 시 정상 복구

## BUG-010 — 생산실적이 없는 기간에 다운타임까지 숨김

- 심각도: High
- 현재 상태: 해결됨
- 반영 커밋: `d82b1d8`
- 영향: 생산 0이지만 장애가 있었던 기간의 엔지니어 분석이 빈 화면이 되던 문제

해결 내용:

- 전체 OEE가 없을 때도 빈 overall metric만 사용하고, 다운타임·설비 데이터 처리를 계속한다.
- 서버 전체 집계 `overallPerformance`를 카드의 우선 데이터로 사용한다.

근거 파일:

- `src/components/dashboard/EngineerDashboard.tsx:438-520`
- `src/hooks/useEngineerData.ts:127-160,258-307`

회귀 방지 기준:

- OEE 일별 데이터 0건, 다운타임 1건인 기간에 다운타임 표와 차트가 표시된다.

## BUG-011 — 집계 OEE API가 기간·추세 방향·주간 라벨을 잘못 처리함

- 심각도: High
- 현재 상태: 해결됨
- 직접 호출자: 현재 감사에서는 확인되지 않은 잠복 API

원인:

- 요청의 `start_date/end_date`를 실제 조회 기준으로 사용하지 않고 고정 기간을 계산한다.
- 내림차순 데이터의 앞 절반을 recent로 취급해 추세 방향이 뒤집힐 수 있다.
- 주간 라벨과 기간 키 생성이 실제 주차 의미와 일치하지 않는다.

근거 파일:

- `src/app/api/oee-data/aggregated/route.ts:75-105`
- `src/app/api/oee-data/aggregated/route.ts:120-170`
- `src/app/api/oee-data/aggregated/route.ts:205-220`

수정 완료 기준:

- 요청 범위를 검증하고 그대로 DB 조회에 적용한다.
- 추세 비교 전에 시간 오름차순을 보장한다.
- ISO week 또는 명시한 영업 주차 규칙으로 라벨을 생성한다.

필수 회귀 테스트:

- 사용자 지정 날짜 범위, 연말 ISO week, 상승·하락 추세 테스트

## BUG-012 — Engineer 주·월·분기 범위가 8·31·91일이 됨

- 심각도: Medium
- 현재 상태: 해결됨
- 영향: 카드·설비별·추세 조회가 UI에 표시된 기간보다 하루 더 포함될 수 있음

원인:

- 종료일을 포함하는 범위에서 시작일을 각각 7, 30, 90일 전으로 설정한다.

근거 파일:

- `src/hooks/useEngineerData.ts:93-123`
- `src/hooks/useMachineOEEStats.ts:38-62`
- `src/hooks/useOEEChartData.ts:45-65`

수정 완료 기준:

- 최근 7일은 오늘 포함 7개 달력일, 최근 30일은 30개 달력일, 최근 90일은 90개 달력일로 통일한다.
- 모든 Engineer API 호출이 동일한 날짜 helper를 공유한다.

필수 회귀 테스트:

- 각 프리셋의 포함 날짜 수와 월말·윤년 테스트

## BUG-013 — 설비별 OEE 재조회 실패 시 이전 필터 통계가 남음

- 심각도: Medium
- 현재 상태: 해결됨
- 영향: 새 기간·설비·교대 필터의 결과처럼 이전 통계가 표시될 수 있음

원인:

- 새 요청 시작 시 `stats`를 비우거나 scope와 결합하지 않는다.
- 요청 실패 시 error만 설정하고 이전 map을 유지한다.

근거 파일:

- `src/hooks/useMachineOEEStats.ts:64-108`

수정 완료 기준:

- 통계 상태에 요청 scope를 저장하고 현재 필터와 일치할 때만 렌더링한다.
- 새 요청 시작 또는 최신 요청 실패 시 이전 scope 데이터를 숨긴다.
- 오래된 응답은 최신 요청을 덮지 못한다.

필수 회귀 테스트:

- 필터 A 성공 후 필터 B 실패
- A/B 요청 역순 응답 테스트

## BUG-014 — OEE 등급 필터 후 JSON 내보내기에 필터 밖 설비 포함

- 심각도: Medium
- 현재 상태: 해결됨

해결 내용:

- 등급은 기간·교대가 반영된 `machineStats`에서 설비 ID 목록으로 변환된다.
- `gradeFilteredMachineIds`를 `useEngineerData`에 전달해 카드·추세·분석 데이터 조회 자체를 같은 설비 집합으로 제한한다.

근거 파일:

- `src/components/dashboard/EngineerDashboard.tsx:107-140`
- `src/components/dashboard/EngineerDashboard.tsx:371-380`
- `src/components/dashboard/EngineerDashboard.tsx:523-560`

회귀 방지 기준:

- 등급 필터 적용 후 화면 표의 설비 ID와 JSON의 `analysisData` 설비 ID가 동일하다.

## BUG-015 — actual/planned runtime 수정 시 downtime_minutes가 동기화되지 않음

- 심각도: Medium
- 현재 상태: 해결됨
- 영향: availability 계산에 사용한 가동시간과 저장된 비가동 시간이 모순될 수 있음

원인:

- 개별 레코드 수정 API는 runtime과 OEE 파생값을 재계산하지만 `downtime_minutes`를 갱신하지 않는다.

근거 파일:

- `src/app/api/production-records/[recordId]/route.ts:100-170`
- `src/app/api/production-records/[recordId]/route.ts:250-315`

수정 완료 기준:

- downtime이 실제 원본이면 runtime 직접 수정을 금지하고 downtime에서 actual runtime을 재계산한다.
- runtime 수정이 허용되는 계약이면 `downtime = planned - actual` 규칙과 미입력 NULL 의미를 명확히 적용한다.
- 저장 후 planned, actual, downtime의 불변조건을 검증한다.

필수 회귀 테스트:

- actual만 수정, planned만 수정, 둘 다 수정, downtime NULL 레코드 수정

## BUG-016 — 관리자 설비 수정의 boolean/null 변환 오류

- 심각도: Medium
- 현재 상태: 해결됨
- 영향: 문자열 `"false"`가 true로 저장되고, null 이름이 문자열 `"null"`로 저장될 수 있음

원인:

- `Boolean(body.is_active)`는 비어 있지 않은 모든 문자열을 true로 변환한다.
- `String(body.name)`은 null을 문자열로 변환한다.

근거 파일:

- `src/lib/machineUpdate.ts:45-70`
- 호출 경로: `src/app/api/admin/machines/[machineId]/route.ts`

수정 완료 기준:

- `is_active`는 JSON boolean만 허용하고 문자열·숫자는 400으로 거부한다.
- name은 trim한 비어 있지 않은 문자열만 허용하며 null을 거부한다.
- current_state와 nullable 필드도 명시적 schema로 검증한다.

필수 회귀 테스트:

- `false`, `"false"`, `0`, `null`, 빈 이름, 공백 이름 입력 테스트

---

## 공통 완료 조건

각 버그 수정 PR은 다음을 충족해야 한다.

- 해당 BUG ID를 PR과 커밋 설명에 기록한다.
- 재현 테스트를 먼저 추가하고 수정 후 통과시킨다.
- OEE·교대·날짜 변경은 0, 음수, 100% 초과, 자정 교차를 검증한다.
- API 변경은 400·404·409·500 및 빈 결과를 확인한다.
- Realtime 변경은 subscribe/unsubscribe, 필터 진입·이탈, 역순 응답을 확인한다.
- `npm run lint`, `npx tsc --noEmit --incremental false`, `npm test -- --runInBand`, `git diff --check` 결과를 각각 기록한다.
- 기존 실패와 새 실패를 분리해 보고한다.
- 신규 migration은 파일만 생성·검토하고 main PR 병합 전에는 운영 DB에 적용하지 않는다.

## 문서 유지 규칙

- 버그 수정 후 항목을 삭제하지 말고 상태와 반영 커밋을 갱신한다.
- 부분 해결이면 해결된 경로와 남은 경로를 모두 기록한다.
- 파일 이동으로 근거가 바뀌면 현재 경로와 심볼 기준으로 수정한다.
- 운영 재현이 완료되면 재현 환경·데이터 규모·실제 영향량을 추가한다.
