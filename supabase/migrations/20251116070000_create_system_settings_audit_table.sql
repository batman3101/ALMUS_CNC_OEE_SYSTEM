-- Create system_settings_audit table for tracking all settings changes
-- Migration: create_system_settings_audit_table
-- Date: 2025-11-16

CREATE TABLE IF NOT EXISTS public.system_settings_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_id UUID NOT NULL REFERENCES public.system_settings(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
  change_reason TEXT,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraint for valid actions
  CONSTRAINT valid_action CHECK (action IN ('CREATE', 'UPDATE', 'DELETE'))
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_settings_audit_setting_id ON public.system_settings_audit(setting_id);
CREATE INDEX IF NOT EXISTS idx_settings_audit_category ON public.system_settings_audit(category);
CREATE INDEX IF NOT EXISTS idx_settings_audit_changed_at ON public.system_settings_audit(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_settings_audit_changed_by ON public.system_settings_audit(changed_by);

-- Enable RLS
ALTER TABLE public.system_settings_audit ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Admins can view all audit logs
CREATE POLICY "Admins can view all audit logs"
  ON public.system_settings_audit
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- Engineers can view audit logs (read-only)
CREATE POLICY "Engineers can view audit logs"
  ON public.system_settings_audit
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role IN ('admin', 'engineer')
    )
  );

-- System can insert audit logs (via trigger or RPC)
CREATE POLICY "System can insert audit logs"
  ON public.system_settings_audit
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Add comment
COMMENT ON TABLE public.system_settings_audit IS 'Audit log for all system settings changes - tracks who changed what, when, and why';
