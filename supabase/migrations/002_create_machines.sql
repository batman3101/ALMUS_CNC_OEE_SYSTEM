-- Create machines table if not exists
CREATE TABLE IF NOT EXISTS machines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255) NOT NULL,
  model_type VARCHAR(255) NOT NULL,
  default_tact_time INTEGER DEFAULT 60,
  is_active BOOLEAN DEFAULT true,
  current_state VARCHAR(50) DEFAULT 'NORMAL_OPERATION',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_machines_is_active ON machines(is_active);
CREATE INDEX IF NOT EXISTS idx_machines_current_state ON machines(current_state);
CREATE INDEX IF NOT EXISTS idx_machines_location ON machines(location);

-- Enable Row Level Security
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all authenticated users to read machines
CREATE POLICY "Authenticated users can read machines" ON machines
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Create policy to allow admins and engineers to create/update machines
CREATE POLICY "Admins and engineers can manage machines" ON machines
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role IN ('admin', 'engineer')
    )
  );

-- Create policy to allow service role full access
CREATE POLICY "Service role has full access to machines" ON machines
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');