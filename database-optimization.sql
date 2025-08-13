-- CNC OEE 모니터링 시스템 데이터베이스 성능 최적화
-- OEE 집계 배치 작업을 위한 추가 최적화

-- OEE 집계 성능 최적화 인덱스
CREATE INDEX IF NOT EXISTS idx_machine_logs_oee_aggregation 
ON machine_logs(machine_id, start_time, state) 
WHERE state = 'NORMAL_OPERATION';

CREATE INDEX IF NOT EXISTS idx_machine_logs_date_range 
ON machine_logs(machine_id, DATE(start_time), state);

CREATE INDEX IF NOT EXISTS idx_production_records_aggregation 
ON production_records(machine_id, date, shift) 
WHERE oee IS NOT NULL;

-- 집계 로그 테이블 최적화 (이미 migration에서 생성되었지만 확인차 추가)
CREATE INDEX IF NOT EXISTS idx_oee_aggregation_log_target_date 
ON oee_aggregation_log(target_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_oee_aggregation_log_execution_date 
ON oee_aggregation_log(execution_date DESC);

-- 복합 인덱스 추가 (교대별 집계 최적화)
CREATE INDEX IF NOT EXISTS idx_machine_logs_shift_aggregation 
ON machine_logs(machine_id, DATE(start_time), EXTRACT(HOUR FROM start_time), state);

-- 생산 실적 조회 최적화
CREATE INDEX IF NOT EXISTS idx_production_records_date_machine 
ON production_records(date DESC, machine_id, shift);

-- 설비 상태별 통계 최적화
CREATE INDEX IF NOT EXISTS idx_machine_logs_state_duration 
ON machine_logs(state, duration) 
WHERE duration IS NOT NULL;

-- 파티셔닝을 위한 준비 (선택사항 - 대용량 데이터 처리 시)
-- machine_logs 테이블의 월별 파티셔닝 예시
/*
-- 파티셔닝 테이블 생성 (기존 테이블 백업 후 실행)
CREATE TABLE machine_logs_partitioned (
  LIKE machine_logs INCLUDING ALL
) PARTITION BY RANGE (DATE(start_time));

-- 월별 파티션 생성 예시
CREATE TABLE machine_logs_2024_12 PARTITION OF machine_logs_partitioned
FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

CREATE TABLE machine_logs_2025_01 PARTITION OF machine_logs_partitioned
FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
*/

-- 통계 정보 업데이트
ANALYZE machine_logs;
ANALYZE production_records;
ANALYZE oee_aggregation_log;

-- 설정 완료 메시지
SELECT 'CNC OEE 모니터링 시스템 OEE 집계 최적화가 완료되었습니다!' as message;