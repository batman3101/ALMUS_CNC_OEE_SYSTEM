-- Add current_state column if it doesn't exist
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

-- Create index for current_state if it doesn't exist
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

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Authenticated users can read machines" ON machines;
DROP POLICY IF EXISTS "Admins and engineers can manage machines" ON machines;
DROP POLICY IF EXISTS "Service role has full access to machines" ON machines;

-- Enable Row Level Security if not already enabled
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;

-- Recreate policies
CREATE POLICY "Authenticated users can read machines" ON machines
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and engineers can manage machines" ON machines
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role IN ('admin', 'engineer')
    )
  );

CREATE POLICY "Service role has full access to machines" ON machines
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');