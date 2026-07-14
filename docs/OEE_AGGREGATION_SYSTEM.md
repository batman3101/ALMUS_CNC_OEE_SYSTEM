# CNC OEE 모니터링 시스템 - 일일 OEE 집계 시스템

> ## ⚠️ 현재 배포 상태 (2026-07-14 확인)
>
> **이 시스템은 배포되어 있지 않으며, 실행되지 않는다.** 운영 Supabase 프로젝트를 직접 조회한 결과:
>
> | 확인 항목 | 상태 |
> |---|---|
> | 배포된 Edge Function | **없음** (`list_edge_functions` → `[]`) |
> | `pg_cron` / `pg_net` 확장 | **미설치** (`cron` 스키마 자체가 없음) |
> | `oee_aggregation_log` 테이블 | **존재하지 않음** |
> | 아래에서 참조하는 cron 마이그레이션 파일 | **저장소에 없음** (git 히스토리 전체에도 없음) |
> | 관리자 UI `OEEAggregationManager` | 어떤 페이지에도 마운트되어 있지 않음 |
>
> 아래 "배포 및 설정", "pg_cron 스케줄" 절은 **아직 실행된 적 없는 계획**이다. 실제 상태로 착각하지 말 것.
>
> ## ⚠️ 이 함수의 역할이 바뀌었다 (중요)
>
> 이전 구현은 **작업자 입력을 파괴하는 두 가지 동작**을 하고 있었다. 배포하는 순간 비가역 손상이
> 발생하므로 2026-07-14 에 아래와 같이 재작성했다.
>
> **제거된 동작 1 — 실적 없는 교대에 0% 레코드 INSERT**
> 생산 수량과 비가동은 작업자가 직접 입력한다. 입력이 없다는 것은 "실적이 0" 이 아니라
> "아직 입력되지 않았다" 이다. (야간조는 20:00 에 시작한다. 주간조 실적을 저장하는 시점에
> 야간조는 시작도 하지 않았다.) 이전 구현은 이런 교대에도 `output_qty=0 / oee=0` 행을 만들어,
> 실행 1회당 최대 1,600개(활성 설비 800 × 2교대)의 유령 행을 생성하고 평균 OEE 를 끌어내렸다.
> 휴무로 삭제한 기록까지 되살아났다.
>
> **제거된 동작 2 — machine_logs 기반 재계산으로 기존 행 UPDATE**
> 이 시스템의 가동률은 로그가 아니라 작업자가 입력한 비가동에서 나온다
> (`planned_runtime = operating_minutes - break_time`, `actual_runtime = planned_runtime - 입력된 비가동`).
> 게다가 `machine_logs` 는 상태 버튼을 누를 때만 남는 희소한 감사 로그다(설비 800대에 8개월 누적 5,351건).
> 대부분의 교대에 로그가 없어, 로그 기반 재계산은 `actual_runtime=0` → 가동률 0% → OEE 0% 로
> 정상 실적을 뭉갠다. 원본 `operating_minutes` 는 DB 에 저장되지 않으므로 복구도 불가능하다.
>
> **현재 동작 — 확정적으로 참인 명제 하나만 적용**
>
> ```
> 생산 수량이 0이면  →  이론 생산시간 = 0,  성능 = 0,  품질 = 0,  OEE = 0
> ```
>
> tact time 도 `planned_runtime` 도 필요 없는, 산술적으로 반박 불가능한 관계다.
> 이 조건을 위반하는 행(2026-07-14 기준 47,748건, 전부 옛 쓰기 경로의 잔재)만 바로잡는다.
> **INSERT 하지 않으며**, `planned_runtime` / `actual_runtime` / `output_qty` / `defect_qty` /
> `downtime_minutes` / `availability` 는 건드리지 않는다.
> 최근 7일 데이터에는 위반 행이 0건이므로, 일상 실행에서는 아무것도 바꾸지 않는다(멱등).
>
> `dry_run: true` 를 주면 계산만 하고 DB 에 쓰지 않는다.
>
> **왜 "지표 전체 재계산" 을 하지 않는가**: 이 DB 의 과거 지표는 여러 세대의 쓰기 경로가 남긴 것이라
> 저장된 입력값과 일관되지 않다. 실측 결과 저장된 입력값으로 파생 지표를 다시 계산하면
> 32.6만 행 중 **93%** 가 바뀐다. 특히 레거시 16만 행은 `planned_runtime=0` 인데 가동률이 0.94 로
> 저장돼 있어, 재계산하면 가동률과 OEE 가 0 이 된다. 이 데이터에서 "재계산" 은 곧 역사 덮어쓰기다.

## 개요

일일 OEE 집계 시스템은 생산 실적 테이블의 OEE 지표 정합성을 보정하는 배치 작업이다.
(과거에는 설비 로그에서 OEE 를 재계산해 저장하는 설계였으나, 위 경고 절의 이유로 폐기되었다)

## 시스템 구성 요소

### 1. Supabase Edge Function
- **파일**: `supabase/functions/daily-oee-aggregation/index.ts`
- **역할**: 기존 생산 실적의 OEE 정합성 보정 (INSERT·덮어쓰기 없음)
- **실행 방식**: HTTP POST 요청으로 트리거
- **현재 배포 여부**: **미배포**

### 2. PostgreSQL 스케줄러 (pg_cron)
- **파일**: `supabase/migrations/20241211000000_setup_daily_oee_cron.sql` — **⚠️ 이 파일은 저장소에 존재하지 않는다**
- **역할**: 자동 스케줄링 및 배치 작업 관리
- **실행 시간(계획)**:
  - 매일 오전 8시 30분 (전날 B교대 집계)
  - 매일 오후 8시 30분 (당일 A교대 집계)
- **현재 설치 여부**: **미설치** (`pg_cron` / `pg_net` 확장 없음)

### 3. 클라이언트 유틸리티
- **파일**: `src/utils/oeeAggregation.ts`
- **역할**: 수동 집계 실행 및 상태 모니터링

### 4. 관리자 UI 컴포넌트
- **파일**: `src/components/admin/OEEAggregationManager.tsx`
- **역할**: 집계 관리 및 모니터링 인터페이스
- **현재 마운트 여부**: **어떤 페이지에도 연결되어 있지 않음**

## OEE 계산 로직

### 1. 가동률 (Availability)
```
가동률 = 실제 가동시간 / 계획 가동시간
```
- **실제 가동시간**: NORMAL_OPERATION 상태의 총 시간
- **계획 가동시간**: `max(0, 가동시간 - 휴식시간)`
  - **가동시간**: 교대별 입력값(분). 미입력 시 교대 1회 = 12시간 = 720분
  - **휴식시간**: `system_settings` 테이블의 `shift` 카테고리 `break_time_minutes` 설정값 (관리자가 설정 화면에서 변경 가능, 설정이 없으면 60분)
  - 예: 가동시간 720분, 휴식시간 110분 → 계획 가동시간 = 610분
  - 서버 측 단일 구현: `src/lib/plannedRuntime.ts` (`getBreakTimeMinutes`, `resolvePlannedRuntime`). 모든 생산 기록 저장 경로가 이 값을 사용한다.
  - **과거 데이터 미백필 안내**: `2026-07-13` (계산식 변경 기준일, `src/lib/oeeCutover.ts`의 `OEE_CALC_CHANGE_DATE`) 이전에 저장된 기록(약 325,197건)은 **재계산(백필)하지 않았다**. 해당 기록은 휴식시간을 차감하지 않은 구 계산식으로 `planned_runtime = 720`이 저장되어 있다. 그중 B교대 기록(약 162,738건)은 별도 버그로 인해 `planned_runtime = 0`으로 저장되어 있었다. 이 때문에 기준일을 넘나드는 가동률·OEE 추이 비교는 유효하지 않으며, 관련 UI(`IndependentOEETrendChart`, `OEETrendChart` 등 날짜축 OEE 추이 차트)는 기준일이 표시 범위에 포함될 때 점선 마커와 안내 문구로 이를 시각적으로 구분한다.

### 2. 성능 (Performance)
```
성능 = 이론 생산시간 / 실제 가동시간
```
- **이론 생산시간**: 생산 수량 × 택트 타임
- **실제 가동시간**: NORMAL_OPERATION 상태의 총 시간

### 3. 품질 (Quality)
```
품질 = 양품 수량 / 총 생산 수량
양품 수량 = 총 생산 수량 - 불량 수량
```

### 4. OEE
```
OEE = 가동률 × 성능 × 품질
```

## 교대별 집계 로직

### A교대 (08:00 - 20:00)
- 집계 시간: 매일 오후 8시 30분
- 대상 데이터: 당일 08:00 ~ 20:00 설비 로그 및 생산 실적

### B교대 (20:00 - 08:00 다음날)
- 집계 시간: 매일 오전 8시 30분
- 대상 데이터: 전날 20:00 ~ 당일 08:00 설비 로그 및 생산 실적

## 데이터 추정 로직

생산 실적이 입력되지 않은 경우, 다음 로직으로 추정:

```typescript
// 실제 가동시간이 있으면 택트 타임 기반으로 생산량 추정
if (actualRuntime > 0 && !existingRecord) {
  const estimatedOutput = Math.floor(actualRuntime * 60 / tactTime);
  outputQty = estimatedOutput;
}
```

## 배포 및 설정

### 1. Edge Function 배포

```bash
# 배포 스크립트 실행
./scripts/deploy-edge-functions.sh

# 또는 수동 배포
supabase functions deploy daily-oee-aggregation --project-ref YOUR_PROJECT_REF
```

### 2. 환경 변수 설정

Supabase 대시보드에서 다음 환경 변수 설정:
- `SUPABASE_URL`: https://YOUR_PROJECT_REF.supabase.co
- `SUPABASE_SERVICE_ROLE_KEY`: 서비스 역할 키

### 3. 데이터베이스 마이그레이션

```sql
-- Supabase SQL Editor에서 실행
\i supabase/migrations/20241211000000_setup_daily_oee_cron.sql
```

### 4. Cron 작업 설정

```sql
-- pg_cron 확장 활성화 (Supabase에서는 기본 활성화)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 일일 집계 작업 등록
SELECT cron.schedule(
  'daily-oee-aggregation',
  '30 8 * * *',
  'SELECT net.http_post(...)'
);
```

## 사용 방법

### 1. 수동 집계 실행

```typescript
import { OEEAggregationService } from '@/utils/oeeAggregation';

// 특정 날짜 집계
const result = await OEEAggregationService.triggerDailyAggregation('2024-12-10');

// 일괄 집계
const dates = ['2024-12-08', '2024-12-09', '2024-12-10'];
const results = await OEEAggregationService.batchAggregation(dates);
```

### 2. 집계 상태 모니터링

```typescript
// 집계 로그 조회
const logs = await OEEAggregationService.getAggregationLogs(20);

// 특정 날짜 집계 상태 확인
const status = await OEEAggregationService.getAggregationStatus('2024-12-10');
```

### 3. 관리자 UI 사용

```tsx
import OEEAggregationManager from '@/components/admin/OEEAggregationManager';

// 관리자 페이지에서 사용
<OEEAggregationManager />
```

## 모니터링 및 로깅

### 1. 집계 로그 테이블

```sql
-- 집계 실행 로그 조회
SELECT * FROM oee_aggregation_log 
ORDER BY created_at DESC 
LIMIT 10;
```

### 2. Cron 작업 상태 확인

```sql
-- 등록된 cron 작업 확인
SELECT * FROM cron_jobs_status;

-- cron 작업 실행 로그 확인
SELECT * FROM cron.job_run_details 
WHERE jobname LIKE '%oee%' 
ORDER BY start_time DESC;
```

### 3. 함수 실행 로그

Supabase 대시보드 > Functions > Logs에서 Edge Function 실행 로그 확인

## 문제 해결

### 1. 집계 실패 시

```sql
-- 실패한 집계 로그 확인
SELECT * FROM oee_aggregation_log 
WHERE status = 'failed' 
ORDER BY created_at DESC;

-- 수동 집계 재실행
SELECT trigger_daily_oee_aggregation('2024-12-10');
```

### 2. Cron 작업 문제

```sql
-- cron 작업 재등록
SELECT cron.unschedule('daily-oee-aggregation');
SELECT cron.schedule('daily-oee-aggregation', '30 8 * * *', '...');
```

### 3. 권한 문제

```sql
-- 함수 실행 권한 확인
GRANT EXECUTE ON FUNCTION trigger_daily_oee_aggregation(DATE) TO authenticated;
```

## 성능 최적화

### 1. 인덱스 최적화

```sql
-- 집계 성능을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_machine_logs_aggregation 
ON machine_logs(machine_id, start_time, state) 
WHERE state = 'NORMAL_OPERATION';

CREATE INDEX IF NOT EXISTS idx_production_records_aggregation 
ON production_records(machine_id, date, shift);
```

### 2. 배치 크기 조정

Edge Function에서 처리하는 설비 수가 많을 경우, 배치 크기를 조정하여 타임아웃 방지:

```typescript
// 설비를 배치로 나누어 처리
const batchSize = 50;
for (let i = 0; i < machines.length; i += batchSize) {
  const batch = machines.slice(i, i + batchSize);
  // 배치 처리 로직
}
```

## 보안 고려사항

### 1. 함수 접근 제어

- Edge Function은 서비스 역할 키로만 호출 가능
- 클라이언트에서는 관리자 권한 확인 후 호출

### 2. 데이터 접근 권한

- RLS 정책으로 집계 로그 접근 제한
- 관리자만 수동 집계 실행 가능

### 3. API 보안

```typescript
// 함수 호출 시 인증 헤더 필수
const { data, error } = await supabase.functions.invoke('daily-oee-aggregation', {
  headers: {
    Authorization: `Bearer ${serviceRoleKey}`
  },
  body: { date }
});
```

## 확장 가능성

### 1. 실시간 집계

현재는 일일 배치 집계이지만, 실시간 집계로 확장 가능:

```typescript
// Supabase Realtime을 활용한 실시간 집계
supabase
  .channel('machine_logs')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'machine_logs' }, 
    (payload) => {
      // 실시간 OEE 업데이트
    }
  )
  .subscribe();
```

### 2. 다중 공장 지원

공장별 집계 로직 추가:

```sql
-- 공장별 집계 테이블
CREATE TABLE factory_oee_summary (
  factory_id UUID,
  date DATE,
  shift VARCHAR(1),
  avg_oee DECIMAL(5,4),
  total_machines INTEGER,
  active_machines INTEGER
);
```

### 3. 예측 분석

과거 데이터를 기반으로 한 OEE 예측:

```typescript
// 머신러닝 모델을 활용한 OEE 예측
const predictedOEE = await predictOEE(machineId, historicalData);
```

## 참고 자료

- [Supabase Edge Functions 문서](https://supabase.com/docs/guides/functions)
- [pg_cron 확장 문서](https://github.com/citusdata/pg_cron)
- [OEE 계산 표준](https://en.wikipedia.org/wiki/Overall_equipment_effectiveness)
- [CNC 설비 모니터링 베스트 프랙티스](https://example.com/cnc-monitoring)