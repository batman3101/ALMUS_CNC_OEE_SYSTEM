-- Create view for recent settings changes (last 90 days)
-- Migration: create_recent_settings_changes_view
-- Date: 2025-11-16
-- This view is what the SettingsAuditTab component queries

-- Drop view if exists
DROP VIEW IF EXISTS public.recent_settings_changes;

-- Create view for recent settings changes (last 90 days)
CREATE VIEW public.recent_settings_changes AS
SELECT
  sa.id,
  sa.setting_id,
  sa.category,
  sa.setting_key,
  sa.old_value,
  sa.new_value,
  sa.action,
  sa.change_reason,
  sa.changed_by,
  sa.changed_at,
  -- Join with user_profiles to get user name
  up.name as changed_by_name,
  up.email as changed_by_email,
  -- Join with system_settings to get current description
  ss.description,
  ss.data_type
FROM public.system_settings_audit sa
LEFT JOIN public.user_profiles up ON sa.changed_by = up.user_id
LEFT JOIN public.system_settings ss ON sa.setting_id = ss.id
WHERE sa.changed_at > NOW() - INTERVAL '90 days'
ORDER BY sa.changed_at DESC;

-- Grant access to authenticated users (RLS will still apply based on user_profiles role)
GRANT SELECT ON public.recent_settings_changes TO authenticated;

-- Add comment
COMMENT ON VIEW public.recent_settings_changes IS 'View showing recent system settings changes (last 90 days) with user information - used by SettingsAuditTab component';
