# CNC OEE 기능 버그 수정 참조서

## 문서 목적

이 문서는 2026-07-15 정적 재감사에서 확인한 기능 버그 16건을 후속 수정 작업의 기준으로 사용하기 위해 정리한 것이다. 최초 감사 기준은 `96df96a`이며, 상태는 `bug-fix-codex-20260715-080308` 브랜치의 `d82b1d8` 커밋까지 반영해 다시 분류했다.

인증·권한·보안 항목은 범위에서 제외했다. 운영 DB 데이터와 브라우저에서 16건 전부를 재현한 결과가 아니라 코드 흐름을 근거로 한 정적 감사이므로, 각 수정 작업은 아래 재현 조건과 완료 기준을 테스트로 고정해야 한다.

## 상태 요약

| 상태 | 건수 | 항목 |
|---|---:|---|
| 미해결 | 12 | BUG-001, 003, 004, 006~009, 011~013, 015~016 |
| 부분 해결 | 2 | BUG-002, 005 |
| 해결됨·회귀 방지 필요 | 2 | BUG-010, 014 |

상태 정의:

- `미해결`: 현재 코드에서도 원인이 남아 있음
- `부분 해결`: 일부 화면이나 데이터 경로는 수정됐지만 동일 원인의 다른 경로가 남아 있음
- `해결됨·회귀 방지 필요`: 현재 코드에서 원인은 제거됐으며 회귀 테스트 유지가 필요함

## 권장 수정 순서

1. BUG-001: 운영자 입력 데이터의 OEE 0 저장
2. BUG-002: 원본 상세·내보내기·로그의 행 제한
3. BUG-003, BUG-015: 과거 OEE 스냅샷 및 가동시간 필드 일관성
4. BUG-004, BUG-007: 입력 화면의 비원자적 저장과 이전 상태 잔존
5. BUG-005, BUG-006: B교대 및 중첩 비가동 집계
6. BUG-008, BUG-009: 실시간 로그와 알림 상태 보존
7. BUG-011~016의 나머지 API·필터·검증 결함

---

## BUG-001 — 운영자 생산입력 시 OEE가 항상 0으로 저장됨

- 심각도: Critical
- 현재 상태: 미해결
- 영향: 운영자 화면에서 입력한 정상 생산 실적의 availability, performance, OEE가 0으로 저장될 수 있음

원인:

- `useProductionRecords`는 생산량과 불량 수량만 전송한다.
- POST API는 누락된 `actual_runtime`을 0으로 처리한다.
- `planned_runtime`도 전송되지 않아 API 기본 가동시간과 화면의 실제 교대 조건이 분리된다.

근거 파일:

- `src/hooks/useProductionRecords.ts:6-35`
- `src/app/api/production-records/route.ts:175-240`

재현 조건:

1. 운영자 생산입력 화면에서 생산량이 0보다 큰 실적을 저장한다.
2. 요청에 `actual_runtime`과 `planned_runtime`이 없는지 확인한다.
3. 저장된 레코드의 availability, performance, OEE가 0인지 확인한다.

수정 완료 기준:

- 운영자 입력 경로가 서버가 계산할 수 있는 가동시간·비가동 정보 또는 명확한 서버 기본 규칙을 제공한다.
- 동일 입력값에 대해 일일 입력 API와 단건 생산입력 API의 OEE 결과가 동일하다.
- 생산량 양수, 불량 0, 가동시간 양수인 정상 입력이 OEE 0으로 저장되지 않는다.

필수 회귀 테스트:

- 런타임 필드가 누락된 요청의 400 처리 또는 서버 기본 계산 테스트
- 생산량 0, 실제 가동시간 0, 정상 생산의 경계값 테스트

## BUG-002 — 대시보드·보고서 데이터가 행 제한에서 조용히 잘림

- 심각도: Critical
- 현재 상태: 부분 해결
- 반영 커밋: `d82b1d8`
- 영향: 전체 통계와 상세 목록·내보내기·설비 로그가 서로 다른 데이터 범위를 보여줄 수 있음

현재 해결된 범위:

- Admin 전체·설비별·일별 OEE 통계
- Engineer 전체 OEE 통계
- 보고서에서 공통 훅을 통해 사용하는 전체 요약 통계
- DB 누적 시간·수량 기반 가중 OEE 집계

남은 범위:

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
- 현재 상태: 미해결
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
- 현재 상태: 미해결
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
- 현재 상태: 부분 해결
- 영향: B교대 비가동 총시간, 일별 추세, 교대별 분석이 서로 다를 수 있음

현재 해결된 범위:

- `machine_logs`는 조회 범위 및 교대 시간창과 교집합을 계산한다.
- 교대를 넘는 상태 로그를 시작 교대에 전량 귀속하던 로직은 제거됐다.

남은 원인:

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
- 현재 상태: 미해결
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

## BUG-007 — 생산 저장 전 추가한 비가동이 고아 데이터로 남음

- 심각도: High
- 현재 상태: 미해결
- 영향: 생산 기록이 없는 날짜·교대의 비가동이 분석에 포함될 수 있음

원인:

- 비가동 입력은 `/api/downtime-entries`로 즉시 저장된다.
- 이후 생산 저장 실패나 화면 이탈을 보상하는 트랜잭션 또는 임시 상태가 없다.

근거 파일:

- `src/components/data-input/ShiftDataInputForm.tsx:658-718`
- `src/app/api/downtime-entries/route.ts`
- 참고: 생산 기록 삭제 시 비가동 정리는 `src/app/api/production-records/[recordId]/route.ts:325-352`에서 별도로 처리됨

수정 완료 기준:

- 생산 실적과 비가동을 하나의 서버 트랜잭션으로 저장하거나 draft/committed 상태를 구분한다.
- 생산 저장 실패 시 새 비가동 입력을 롤백하거나 사용자에게 복구 가능한 상태로 남긴다.
- 분석 API는 orphan/draft 비가동을 공식 통계에서 제외한다.

필수 회귀 테스트:

- 비가동 저장 성공 후 생산 저장 실패
- 비가동 추가 후 브라우저 이탈 및 재진입

## BUG-008 — 실시간 로그 INSERT 후 5,000건 상태가 100건으로 축소됨

- 심각도: High
- 현재 상태: 미해결
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
- 현재 상태: 미해결
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
- 현재 상태: 해결됨·회귀 방지 필요
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
- 현재 상태: 미해결
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
- 현재 상태: 미해결
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
- 현재 상태: 미해결
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
- 현재 상태: 해결됨·회귀 방지 필요

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
- 현재 상태: 미해결
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
- 현재 상태: 미해결
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

## 문서 유지 규칙

- 버그 수정 후 항목을 삭제하지 말고 상태와 반영 커밋을 갱신한다.
- 부분 해결이면 해결된 경로와 남은 경로를 모두 기록한다.
- 파일 이동으로 근거가 바뀌면 현재 경로와 심볼 기준으로 수정한다.
- 운영 재현이 완료되면 재현 환경·데이터 규모·실제 영향량을 추가한다.
