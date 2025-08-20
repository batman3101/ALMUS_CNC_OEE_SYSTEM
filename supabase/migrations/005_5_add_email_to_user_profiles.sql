-- Add email column and is_active column to user_profiles table
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS email VARCHAR(255),
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Create index for email
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);

-- Create index for is_active
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_active ON user_profiles(is_active);