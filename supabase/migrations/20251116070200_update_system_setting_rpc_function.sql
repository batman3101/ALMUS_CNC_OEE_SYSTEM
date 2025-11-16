-- Update RPC function to properly handle audit logging
-- Migration: update_system_setting_rpc_function
-- Date: 2025-11-16
-- Removes silent exception handling and improves change_reason support

CREATE OR REPLACE FUNCTION public.update_system_setting(
  p_category text,
  p_key text,
  p_value text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_setting_id uuid;
  v_old_value jsonb;
  v_new_value jsonb;
  v_user_id uuid;
BEGIN
  -- Parse the new value intelligently
  BEGIN
    v_new_value := jsonb_build_object('value', to_jsonb(p_value::text));
    -- Try to parse as proper JSON if possible
    IF p_value ~ '^[\[\{].*[\]\}]$' OR p_value ~ '^".*"$' OR p_value IN ('true', 'false', 'null') OR p_value ~ '^\d+(\.\d+)?$' THEN
      v_new_value := jsonb_build_object('value', p_value::jsonb);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_new_value := jsonb_build_object('value', p_value);
  END;

  -- Get current user
  v_user_id := auth.uid();

  -- Check if setting exists and get old value
  SELECT id, setting_value INTO v_setting_id, v_old_value
  FROM system_settings
  WHERE category = p_category AND setting_key = p_key;

  IF v_setting_id IS NOT NULL THEN
    -- Update existing setting
    UPDATE system_settings
    SET
      setting_value = v_new_value,
      updated_at = now(),
      updated_by = v_user_id
    WHERE id = v_setting_id;

    -- Log the update to audit table
    INSERT INTO system_settings_audit (
      setting_id, category, setting_key, old_value, new_value,
      action, changed_by, change_reason
    ) VALUES (
      v_setting_id, p_category, p_key, v_old_value, v_new_value,
      'UPDATE', v_user_id, p_reason
    );
  ELSE
    -- Insert new setting
    INSERT INTO system_settings (
      category, setting_key, setting_value, default_value,
      description, data_type, is_active, is_system,
      created_by, updated_by
    ) VALUES (
      p_category, p_key, v_new_value, v_new_value,
      p_key || ' setting', 'string', true, false,
      v_user_id, v_user_id
    ) RETURNING id INTO v_setting_id;

    -- Log the creation to audit table
    INSERT INTO system_settings_audit (
      setting_id, category, setting_key, new_value,
      action, changed_by, change_reason
    ) VALUES (
      v_setting_id, p_category, p_key, v_new_value,
      'CREATE', v_user_id, p_reason
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'setting_id', v_setting_id);
END;
$$;

-- Add comment
COMMENT ON FUNCTION public.update_system_setting(text, text, text, text)
  IS 'Updates a system setting and logs the change to system_settings_audit table with optional change reason';

-- Disable the trigger since RPC function handles audit logging
DROP TRIGGER IF EXISTS trigger_audit_system_settings_change ON public.system_settings;

-- Keep the trigger function for potential future use, but don't attach it
COMMENT ON FUNCTION public.audit_system_settings_change()
  IS 'Trigger function for auditing system settings changes - Currently not attached, RPC function handles audit logging instead';
