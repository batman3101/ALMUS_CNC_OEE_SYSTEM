-- Performance: add covering indexes for foreign keys (unindexed_foreign_keys advisory).
-- An FK column without a covering index forces sequential scans for joins and for the referential
-- integrity checks run on the parent's DELETE/UPDATE. All five are single-column user references.
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by
  ON public.audit_log (changed_by);
CREATE INDEX IF NOT EXISTS idx_downtime_entries_operator_id
  ON public.downtime_entries (operator_id);
CREATE INDEX IF NOT EXISTS idx_machine_status_history_changed_by
  ON public.machine_status_history (changed_by);
CREATE INDEX IF NOT EXISTS idx_system_settings_created_by
  ON public.system_settings (created_by);
CREATE INDEX IF NOT EXISTS idx_system_settings_updated_by
  ON public.system_settings (updated_by);
