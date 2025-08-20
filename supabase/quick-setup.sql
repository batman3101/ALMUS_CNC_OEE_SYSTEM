-- Quick setup script for Supabase
-- Run this entire script in Supabase SQL Editor

-- 1. Add current_state column to machines table
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'machines' 
        AND column_name = 'current_state'
    ) THEN 
        ALTER TABLE machines 
        ADD COLUMN current_state VARCHAR(50) DEFAULT 'NORMAL_OPERATION';
    END IF;
END $$;

-- 2. Create index for current_state
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE tablename = 'machines'
        AND indexname = 'idx_machines_current_state'
    ) THEN
        CREATE INDEX idx_machines_current_state ON machines(current_state);
    END IF;
END $$;

-- 3. Update existing machines to have current_state
UPDATE machines 
SET current_state = 'NORMAL_OPERATION' 
WHERE current_state IS NULL;

-- 4. Insert sample machines if table is empty
INSERT INTO machines (name, location, model_type, default_tact_time, is_active, current_state)
SELECT * FROM (VALUES
  ('CNC-001', '1공장 A라인', 'Mazak VTC-800', 60, true, 'NORMAL_OPERATION'),
  ('CNC-002', '1공장 B라인', 'DMG Mori NLX2500', 45, true, 'MAINTENANCE'),
  ('CNC-003', '2공장 A라인', 'Okuma Genos L250', 75, false, 'PLANNED_STOP'),
  ('CNC-004', '2공장 B라인', 'Haas VF-2', 50, true, 'NORMAL_OPERATION'),
  ('CNC-005', '3공장 A라인', 'Mazak Integrex', 90, true, 'TOOL_CHANGE')
) AS sample_data(name, location, model_type, default_tact_time, is_active, current_state)
WHERE NOT EXISTS (SELECT 1 FROM machines LIMIT 1);

-- 5. Enable RLS and create policies
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Authenticated users can read machines" ON machines;
DROP POLICY IF EXISTS "Admins and engineers can manage machines" ON machines;
DROP POLICY IF EXISTS "Service role has full access to machines" ON machines;

-- Recreate policies
CREATE POLICY "Authenticated users can read machines" ON machines
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role has full access to machines" ON machines
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');