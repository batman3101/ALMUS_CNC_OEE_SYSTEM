-- =============================================================================
-- 설비 상태 enum 업데이트 - TypeScript 타입과 동기화
-- =============================================================================

-- 1. 기존 제약조건 제거
ALTER TABLE machine_logs DROP CONSTRAINT IF EXISTS machine_logs_state_check;

-- 2. 새로운 상태값들을 포함한 제약조건 추가
ALTER TABLE machine_logs ADD CONSTRAINT machine_logs_state_check 
CHECK (state IN (
    'NORMAL_OPERATION',    -- 정상가동
    'INSPECTION',          -- 점검중
    'BREAKDOWN_REPAIR',    -- 고장수리
    'PM_MAINTENANCE',      -- 예방정비
    'MODEL_CHANGE',        -- 모델교체
    'PLANNED_STOP',        -- 계획정지
    'PROGRAM_CHANGE',      -- 프로그램 교체
    'TOOL_CHANGE',         -- 공구교환
    'TEMPORARY_STOP'       -- 일시정지
));

-- 3. 기존 'MAINTENANCE' 상태를 'INSPECTION'으로 변경
UPDATE machine_logs 
SET state = 'INSPECTION' 
WHERE state = 'MAINTENANCE';

-- 4. machines 테이블에 current_state 컬럼 추가 (없는 경우)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'machines' AND column_name = 'current_state'
    ) THEN
        ALTER TABLE machines ADD COLUMN current_state TEXT;
        
        -- 제약조건 추가
        ALTER TABLE machines ADD CONSTRAINT machines_current_state_check 
        CHECK (current_state IN (
            'NORMAL_OPERATION', 'INSPECTION', 'BREAKDOWN_REPAIR', 'PM_MAINTENANCE',
            'MODEL_CHANGE', 'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP'
        ));
        
        -- 기본값 설정
        UPDATE machines SET current_state = 'NORMAL_OPERATION' WHERE current_state IS NULL;
        
        -- 인덱스 추가
        CREATE INDEX IF NOT EXISTS idx_machines_current_state ON machines(current_state);
    END IF;
END $$;

-- 5. 설비 상태 설명 테이블 생성
CREATE TABLE IF NOT EXISTS machine_status_descriptions (
    id SERIAL PRIMARY KEY,
    status TEXT NOT NULL UNIQUE,
    description_ko TEXT NOT NULL,
    description_vi TEXT,
    description_en TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. 상태 설명 데이터 삽입
INSERT INTO machine_status_descriptions (status, description_ko, description_vi, description_en, display_order) VALUES
('NORMAL_OPERATION', '정상가동', 'Hoạt động bình thường', 'Normal Operation', 1),
('INSPECTION', '점검중', 'Kiểm tra', 'Inspection', 2),
('BREAKDOWN_REPAIR', '고장수리', 'Sửa chữa hỏng hóc', 'Breakdown Repair', 3),
('PM_MAINTENANCE', '예방정비', 'Bảo trì phòng ngừa', 'Preventive Maintenance', 4),
('MODEL_CHANGE', '모델교체', 'Thay đổi mô hình', 'Model Change', 5),
('PLANNED_STOP', '계획정지', 'Dừng theo kế hoạch', 'Planned Stop', 6),
('PROGRAM_CHANGE', '프로그램 교체', 'Thay đổi chương trình', 'Program Change', 7),
('TOOL_CHANGE', '공구교환', 'Thay dụng cụ', 'Tool Change', 8),
('TEMPORARY_STOP', '일시정지', 'Dừng tạm thời', 'Temporary Stop', 9)
ON CONFLICT (status) DO UPDATE SET
    description_ko = EXCLUDED.description_ko,
    description_vi = EXCLUDED.description_vi,
    description_en = EXCLUDED.description_en,
    display_order = EXCLUDED.display_order;

-- 7. RLS 정책 설정
ALTER TABLE machine_status_descriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to machine_status_descriptions" ON machine_status_descriptions
    FOR ALL USING (true);

-- 8. 실시간 구독 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE machine_status_descriptions;

-- 완료 메시지
SELECT 'Machine state enum updated successfully!' as status;