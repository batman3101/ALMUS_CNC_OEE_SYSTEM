-- Add processing_step column to machines table
ALTER TABLE machines ADD COLUMN IF NOT EXISTS processing_step VARCHAR(100);

-- Set default value for existing records
UPDATE machines SET processing_step = '1 공정' WHERE processing_step IS NULL;

-- Make the column NOT NULL after setting default values
ALTER TABLE machines ALTER COLUMN processing_step SET NOT NULL;

-- Create index for processing_step
CREATE INDEX IF NOT EXISTS idx_machines_processing_step ON machines(processing_step);