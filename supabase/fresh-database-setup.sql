-- =============================================================================
-- CNC OEE 모니터링 시스템 - 완전 새로운 데이터베이스 설정
-- =============================================================================
-- 현재 TypeScript 코드베이스와 완벽히 매칭되는 데이터베이스 스키마
-- src/types/database.ts 및 src/types/index.ts 기반으로 생성

-- 기존 테이블 완전 삭제 (의존성 순서대로)
DROP TABLE IF EXISTS production_records CASCADE;
DROP TABLE IF EXISTS machine_logs CASCADE;
DROP TABLE IF EXISTS machines CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;

-- RLS 정책도 모두 삭제됨 (CASCADE로 인해)

-- =============================================================================
-- 1. 사용자 프로필 테이블 (user_profiles)
-- =============================================================================
CREATE TABLE user_profiles (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'engineer')),
    assigned_machines TEXT[] DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- user_profiles 인덱스
CREATE INDEX idx_user_profiles_role ON user_profiles(role);
CREATE INDEX idx_user_profiles_assigned_machines ON user_profiles USING GIN(assigned_machines);

-- user_profiles RLS 활성화
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- user_profiles RLS 정책 (개발용 - 모든 사용자 접근 허용)
CREATE POLICY "Allow all access to user_profiles" ON user_profiles
    FOR ALL USING (true);

-- =============================================================================
-- 2. 설비 테이블 (machines)
-- =============================================================================
CREATE TABLE machines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    location TEXT,
    model_type TEXT,
    default_tact_time INTEGER NOT NULL DEFAULT 120,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- machines 인덱스
CREATE INDEX idx_machines_is_active ON machines(is_active);
CREATE INDEX idx_machines_name ON machines(name);
CREATE INDEX idx_machines_location ON machines(location);

-- machines RLS 활성화
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;

-- machines RLS 정책 (개발용 - 모든 접근 허용)
CREATE POLICY "Allow all access to machines" ON machines
    FOR ALL USING (true);

-- =============================================================================
-- 3. 설비 로그 테이블 (machine_logs)
-- =============================================================================
CREATE TABLE machine_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN (
        'NORMAL_OPERATION', 'MAINTENANCE', 'MODEL_CHANGE', 
        'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP'
    )),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    duration INTEGER, -- 분 단위
    operator_id UUID REFERENCES user_profiles(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- machine_logs 인덱스
CREATE INDEX idx_machine_logs_machine_id ON machine_logs(machine_id);
CREATE INDEX idx_machine_logs_start_time ON machine_logs(start_time DESC);
CREATE INDEX idx_machine_logs_state ON machine_logs(state);
CREATE INDEX idx_machine_logs_operator_id ON machine_logs(operator_id);

-- machine_logs RLS 활성화
ALTER TABLE machine_logs ENABLE ROW LEVEL SECURITY;

-- machine_logs RLS 정책 (개발용 - 모든 접근 허용)
CREATE POLICY "Allow all access to machine_logs" ON machine_logs
    FOR ALL USING (true);

-- =============================================================================
-- 4. 생산 실적 테이블 (production_records)
-- =============================================================================
CREATE TABLE production_records (
    record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    shift TEXT CHECK (shift IN ('A', 'B')),
    planned_runtime INTEGER DEFAULT 480, -- 분 단위 (8시간 = 480분)
    actual_runtime INTEGER DEFAULT 0,
    ideal_runtime INTEGER DEFAULT 0,
    output_qty INTEGER NOT NULL DEFAULT 0,
    defect_qty INTEGER NOT NULL DEFAULT 0,
    availability DECIMAL(5,4), -- 0.0000 ~ 1.0000
    performance DECIMAL(5,4),  -- 0.0000 ~ 1.0000
    quality DECIMAL(5,4),      -- 0.0000 ~ 1.0000
    oee DECIMAL(5,4),          -- 0.0000 ~ 1.0000
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(machine_id, date, shift)
);

-- production_records 인덱스
CREATE INDEX idx_production_records_machine_id ON production_records(machine_id);
CREATE INDEX idx_production_records_date ON production_records(date DESC);
CREATE INDEX idx_production_records_shift ON production_records(shift);
CREATE INDEX idx_production_records_oee ON production_records(oee DESC);

-- production_records RLS 활성화
ALTER TABLE production_records ENABLE ROW LEVEL SECURITY;

-- production_records RLS 정책 (개발용 - 모든 접근 허용)
CREATE POLICY "Allow all access to production_records" ON production_records
    FOR ALL USING (true);

-- =============================================================================
-- 5. 업데이트 타임스탬프 트리거 함수
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- updated_at 컬럼 자동 업데이트 트리거
CREATE TRIGGER update_user_profiles_updated_at 
    BEFORE UPDATE ON user_profiles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_machines_updated_at 
    BEFORE UPDATE ON machines 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 6. 실시간 구독을 위한 발행 설정
-- =============================================================================
-- 모든 테이블의 변경사항을 실시간으로 구독할 수 있도록 발행 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE user_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE machines;
ALTER PUBLICATION supabase_realtime ADD TABLE machine_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE production_records;

-- =============================================================================
-- 7. 샘플 데이터 삽입
-- =============================================================================

-- 관리자 계정 생성 (실제 운영시에는 Supabase Auth를 통해 생성)
-- 임시 UUID 사용 (실제로는 auth.users에서 생성된 UUID 사용)
INSERT INTO user_profiles (user_id, name, role) VALUES 
('550e8400-e29b-41d4-a716-446655440000', '관리자', 'admin'),
('550e8400-e29b-41d4-a716-446655440001', '엔지니어1', 'engineer'),
('550e8400-e29b-41d4-a716-446655440002', '운영자1', 'operator');

-- 설비 데이터
INSERT INTO machines (id, name, location, model_type, default_tact_time, is_active) VALUES 
('01234567-89ab-cdef-0123-456789abcdef', 'CNC-001', 'A동 1층', 'DMG MORI', 120, true),
('11234567-89ab-cdef-0123-456789abcdef', 'CNC-002', 'A동 1층', 'MAZAK', 90, true),
('21234567-89ab-cdef-0123-456789abcdef', 'CNC-003', 'A동 2층', 'HAAS', 150, true),
('31234567-89ab-cdef-0123-456789abcdef', 'CNC-004', 'B동 1층', 'DMG MORI', 110, true),
('41234567-89ab-cdef-0123-456789abcdef', 'CNC-005', 'B동 2층', 'OKUMA', 130, true);

-- 운영자에게 설비 할당
UPDATE user_profiles 
SET assigned_machines = ARRAY['01234567-89ab-cdef-0123-456789abcdef', '11234567-89ab-cdef-0123-456789abcdef']
WHERE user_id = '550e8400-e29b-41d4-a716-446655440002';

-- 최근 설비 로그 데이터
INSERT INTO machine_logs (machine_id, state, start_time, end_time, duration, operator_id) VALUES 
('01234567-89ab-cdef-0123-456789abcdef', 'NORMAL_OPERATION', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', 60, '550e8400-e29b-41d4-a716-446655440002'),
('11234567-89ab-cdef-0123-456789abcdef', 'MAINTENANCE', NOW() - INTERVAL '1 hour', NULL, NULL, '550e8400-e29b-41d4-a716-446655440001'),
('21234567-89ab-cdef-0123-456789abcdef', 'NORMAL_OPERATION', NOW() - INTERVAL '3 hours', NOW(), 180, '550e8400-e29b-41d4-a716-446655440002'),
('31234567-89ab-cdef-0123-456789abcdef', 'TEMPORARY_STOP', NOW() - INTERVAL '30 minutes', NULL, NULL, '550e8400-e29b-41d4-a716-446655440002'),
('41234567-89ab-cdef-0123-456789abcdef', 'NORMAL_OPERATION', NOW() - INTERVAL '4 hours', NOW() - INTERVAL '1 hour', 180, '550e8400-e29b-41d4-a716-446655440002');

-- 생산 실적 데이터 (최근 7일)
INSERT INTO production_records (machine_id, date, shift, planned_runtime, actual_runtime, ideal_runtime, output_qty, defect_qty, availability, performance, quality, oee) VALUES 
-- CNC-001 데이터
('01234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE, 'A', 480, 420, 380, 950, 50, 0.875, 0.905, 0.947, 0.750),
('01234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE - 1, 'A', 480, 440, 400, 1000, 30, 0.917, 0.909, 0.970, 0.808),
('01234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE - 2, 'A', 480, 460, 420, 1050, 45, 0.958, 0.913, 0.957, 0.837),

-- CNC-002 데이터  
('11234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE, 'A', 480, 300, 270, 600, 40, 0.625, 0.900, 0.933, 0.525),
('11234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE - 1, 'A', 480, 400, 360, 800, 20, 0.833, 0.900, 0.975, 0.731),
('11234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE - 2, 'A', 480, 450, 410, 920, 35, 0.938, 0.911, 0.962, 0.822),

-- CNC-003 데이터
('21234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE, 'A', 480, 470, 440, 880, 20, 0.979, 0.936, 0.977, 0.895),
('21234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE - 1, 'A', 480, 460, 430, 860, 25, 0.958, 0.935, 0.971, 0.871),
('21234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE - 2, 'A', 480, 450, 420, 840, 30, 0.938, 0.933, 0.964, 0.844),

-- CNC-004 데이터
('31234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE, 'A', 480, 280, 250, 500, 60, 0.583, 0.893, 0.880, 0.458),
('31234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE - 1, 'A', 480, 320, 290, 580, 45, 0.667, 0.906, 0.922, 0.557),
('31234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE - 2, 'A', 480, 380, 350, 700, 35, 0.792, 0.921, 0.950, 0.693),

-- CNC-005 데이터
('41234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE, 'A', 480, 400, 370, 740, 35, 0.833, 0.925, 0.953, 0.735),
('41234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE - 1, 'A', 480, 430, 400, 800, 25, 0.896, 0.930, 0.969, 0.807),
('41234567-89ab-cdef-0123-456789abcdef', CURRENT_DATE - 2, 'A', 480, 450, 420, 840, 30, 0.938, 0.933, 0.964, 0.844);

-- =============================================================================
-- 8. 뷰 및 함수 생성
-- =============================================================================

-- 현재 설비 상태 뷰
CREATE OR REPLACE VIEW current_machine_status AS
SELECT 
    m.id,
    m.name,
    m.location,
    m.model_type,
    m.is_active,
    COALESCE(
        (SELECT state FROM machine_logs 
         WHERE machine_id = m.id AND end_time IS NULL 
         ORDER BY start_time DESC LIMIT 1), 
        'NORMAL_OPERATION'
    ) as current_state,
    (SELECT start_time FROM machine_logs 
     WHERE machine_id = m.id AND end_time IS NULL 
     ORDER BY start_time DESC LIMIT 1) as state_start_time
FROM machines m
WHERE m.is_active = true;

-- 최신 OEE 지표 뷰
CREATE OR REPLACE VIEW latest_oee_metrics AS
SELECT 
    pr.*,
    m.name as machine_name,
    m.location
FROM production_records pr
JOIN machines m ON pr.machine_id = m.id
WHERE (pr.machine_id, pr.date) IN (
    SELECT machine_id, MAX(date)
    FROM production_records
    GROUP BY machine_id
);

-- =============================================================================
-- 완료 메시지
-- =============================================================================
-- 데이터베이스 설정이 완료되었습니다.
-- 이제 useRealtimeData 훅이 올바르게 작동할 것입니다.

SELECT 'Fresh database setup completed successfully!' as status;