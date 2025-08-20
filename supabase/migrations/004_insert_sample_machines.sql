-- Insert sample machines data if table is empty
INSERT INTO machines (name, location, model_type, default_tact_time, is_active, current_state)
SELECT * FROM (VALUES
  ('CNC-001', '1공장 A라인', 'Mazak VTC-800', 60, true, 'NORMAL_OPERATION'),
  ('CNC-002', '1공장 B라인', 'DMG Mori NLX2500', 45, true, 'MAINTENANCE'),
  ('CNC-003', '2공장 A라인', 'Okuma Genos L250', 75, false, 'PLANNED_STOP'),
  ('CNC-004', '2공장 B라인', 'Haas VF-2', 50, true, 'NORMAL_OPERATION'),
  ('CNC-005', '3공장 A라인', 'Mazak Integrex', 90, true, 'TOOL_CHANGE')
) AS sample_data(name, location, model_type, default_tact_time, is_active, current_state)
WHERE NOT EXISTS (SELECT 1 FROM machines LIMIT 1);