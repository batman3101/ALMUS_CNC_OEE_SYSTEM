-- 일일 OEE 집계를 위한 pg_cron 설정
-- 이 스크립트는 Supabase 프로덕션 환경에서 실행해야 합니다.

-- pg_cron 확장 활성화 (Supabase에서는 기본적으로 활성화되어 있음)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 기존 OEE 집계 작업이 있다면 제거
SELECT cron.unschedule('daily-oee-aggregation');

-- 매일 오전 8시 30분에 전날 OEE 집계 실행
-- (A교대 종료 후 30분, B교대 종료 후 30분에 실행)
SELECT cron.schedule(
  'daily-oee-aggregation',
  '30 8 * * *', -- 매일 오전 8시 30분
  $$
  SELECT
    net.http_post(
      url := 'https://your-project-ref.supabase.co/functions/v1/daily-oee-aggregation',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key') || '"}',
      body := '{"date": "' || (CURRENT_DATE - INTERVAL '1 day')::text || '"}'
    ) as request_id;
  $$
);

-- 매일 오후 8시 30분에 당일 A교대 OEE 집계 실행
SELECT cron.schedule(
  'daily-oee-aggregation-a-shift',
  '30 20 * * *', -- 매일 오후 8시 30분
  $$
  SELECT
    net.http_post(
      url := 'https://your-project-ref.supabase.co/functions/v1/daily-oee-aggregation',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key') || '"}',
      body := '{"date": "' || CURRENT_DATE::text || '"}'
    ) as request_id;
  $$
);

-- 수동 OEE 집계를 위한 함수 생성
CREATE OR REPLACE FUNCTION trigger_daily_oee_aggregation(target_date DATE DEFAULT CURRENT_DATE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result TEXT;
BEGIN
  -- Edge Function 호출
  SELECT
    net.http_post(
      url := 'https://your-project-ref.supabase.co/functions/v1/daily-oee-aggregation',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key') || '"}',
      body := '{"date": "' || target_date::text || '"}'
    )::TEXT INTO result;
  
  RETURN 'OEE aggregation triggered for date: ' || target_date::text || '. Request ID: ' || result;
END;
$$;

-- 함수 실행 권한 설정
GRANT EXECUTE ON FUNCTION trigger_daily_oee_aggregation(DATE) TO authenticated;

-- 관리자만 수동 집계 함수 실행 가능하도록 RLS 정책 생성
CREATE POLICY "Only admins can trigger OEE aggregation" ON production_records
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );

-- 집계 작업 로그를 위한 테이블 생성
CREATE TABLE IF NOT EXISTS oee_aggregation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_date DATE NOT NULL,
  target_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  processed_records INTEGER DEFAULT 0,
  error_message TEXT,
  execution_time_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- 인덱스
  UNIQUE(target_date, execution_date, status)
);

-- 집계 로그 인덱스
CREATE INDEX IF NOT EXISTS idx_oee_aggregation_log_date ON oee_aggregation_log(target_date DESC);
CREATE INDEX IF NOT EXISTS idx_oee_aggregation_log_status ON oee_aggregation_log(status);

-- 집계 로그 RLS 정책
ALTER TABLE oee_aggregation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and engineers can view aggregation log" ON oee_aggregation_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() 
      AND role IN ('admin', 'engineer') 
      AND is_active = true
    )
  );

-- 집계 시작 로그 함수
CREATE OR REPLACE FUNCTION log_oee_aggregation_start(target_date DATE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  log_id UUID;
BEGIN
  INSERT INTO oee_aggregation_log (execution_date, target_date, status)
  VALUES (CURRENT_DATE, target_date, 'started')
  RETURNING id INTO log_id;
  
  RETURN log_id;
END;
$$;

-- 집계 완료 로그 함수
CREATE OR REPLACE FUNCTION log_oee_aggregation_complete(
  log_id UUID,
  processed_count INTEGER,
  execution_time INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE oee_aggregation_log
  SET 
    status = 'completed',
    processed_records = processed_count,
    execution_time_ms = execution_time
  WHERE id = log_id;
END;
$$;

-- 집계 실패 로그 함수
CREATE OR REPLACE FUNCTION log_oee_aggregation_error(
  log_id UUID,
  error_msg TEXT,
  execution_time INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE oee_aggregation_log
  SET 
    status = 'failed',
    error_message = error_msg,
    execution_time_ms = execution_time
  WHERE id = log_id;
END;
$$;

-- 오래된 집계 로그 정리 함수 (30일 이상 된 로그 삭제)
CREATE OR REPLACE FUNCTION cleanup_old_aggregation_logs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM oee_aggregation_log
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- 매주 일요일 오전 2시에 오래된 로그 정리
SELECT cron.schedule(
  'cleanup-oee-aggregation-logs',
  '0 2 * * 0', -- 매주 일요일 오전 2시
  'SELECT cleanup_old_aggregation_logs();'
);

-- 현재 등록된 cron 작업 확인 뷰
CREATE OR REPLACE VIEW cron_jobs_status AS
SELECT 
  jobid,
  schedule,
  command,
  nodename,
  nodeport,
  database,
  username,
  active,
  jobname
FROM cron.job
WHERE jobname LIKE '%oee%' OR jobname LIKE '%aggregation%';

-- 뷰 접근 권한 (관리자만)
GRANT SELECT ON cron_jobs_status TO authenticated;

CREATE POLICY "Only admins can view cron jobs" ON cron.job
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );

-- 설정 완료 메시지
SELECT 'Daily OEE aggregation cron jobs have been set up successfully!' as message;

-- 참고: 실제 프로덕션 환경에서는 다음 설정을 수정해야 합니다:
-- 1. 'your-project-ref.supabase.co'를 실제 Supabase 프로젝트 URL로 변경
-- 2. service_role_key 설정 확인
-- 3. 시간대 설정 확인 (기본적으로 UTC 기준)

-- 한국 시간대 기준으로 cron 작업을 설정하려면:
-- 매일 오전 8시 30분 KST = 23시 30분 UTC (전날)
-- 매일 오후 8시 30분 KST = 11시 30분 UTC

-- 한국 시간대 기준 cron 작업 (선택사항)
/*
SELECT cron.unschedule('daily-oee-aggregation');
SELECT cron.unschedule('daily-oee-aggregation-a-shift');

-- 매일 오전 8시 30분 KST (23시 30분 UTC 전날)
SELECT cron.schedule(
  'daily-oee-aggregation-kst',
  '30 23 * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://your-project-ref.supabase.co/functions/v1/daily-oee-aggregation',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key') || '"}',
      body := '{"date": "' || CURRENT_DATE::text || '"}'
    ) as request_id;
  $$
);

-- 매일 오후 8시 30분 KST (11시 30분 UTC)
SELECT cron.schedule(
  'daily-oee-aggregation-a-shift-kst',
  '30 11 * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://your-project-ref.supabase.co/functions/v1/daily-oee-aggregation',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.service_role_key') || '"}',
      body := '{"date": "' || CURRENT_DATE::text || '"}'
    ) as request_id;
  $$
);
*/