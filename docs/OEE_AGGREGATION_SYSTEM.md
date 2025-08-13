# CNC OEE 모니터링 시스템 - 일일 OEE 집계 시스템

## 개요

일일 OEE 집계 시스템은 CNC 설비의 운영 데이터를 자동으로 수집하고 OEE(Overall Equipment Effectiveness) 지표를 계산하여 생산 실적 테이블에 저장하는 배치 작업 시스템입니다.

## 시스템 구성 요소

### 1. Supabase Edge Function
- **파일**: `supabase/functions/daily-oee-aggregation/index.ts`
- **역할**: 일일 OEE 계산 및 집계 로직 실행
- **실행 방식**: HTTP POST 요청으로 트리거

### 2. PostgreSQL 스케줄러 (pg_cron)
- **파일**: `supabase/migrations/20241211000000_setup_daily_oee_cron.sql`
- **역할**: 자동 스케줄링 및 배치 작업 관리
- **실행 시간**: 
  - 매일 오전 8시 30분 (전날 B교대 집계)
  - 매일 오후 8시 30분 (당일 A교대 집계)

### 3. 클라이언트 유틸리티
- **파일**: `src/utils/oeeAggregation.ts`
- **역할**: 수동 집계 실행 및 상태 모니터링

### 4. 관리자 UI 컴포넌트
- **파일**: `src/components/admin/OEEAggregationManager.tsx`
- **역할**: 집계 관리 및 모니터링 인터페이스

## OEE 계산 로직

### 1. 가동률 (Availability)
```
가동률 = 실제 가동시간 / 계획 가동시간
```
- **실제 가동시간**: NORMAL_OPERATION 상태의 총 시간
- **계획 가동시간**: 교대 시간(12시간) - 계획된 휴식시간(60분) = 660분

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