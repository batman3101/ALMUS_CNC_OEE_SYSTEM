import { supabaseAdmin } from '@/lib/supabase-admin';
import type { ForecastCapacitySnapshot, ForecastSnapshotModel } from '@/types/forecast';

/** Well above 800 machines / ~60 processes; hitting it means the query was cut, so the snapshot is refused. */
export const SNAPSHOT_LIMIT = 5000;

interface ModelRow { id: string; model_name: string; is_active: boolean }
interface ProcessRow { id: string; model_id: string; process_name: string; process_order: number; tact_time_seconds: number | null }
interface MachineRow { id: string; name: string; location: string | null; is_active: boolean; production_model_id: string | null; current_process_id: string | null }

/** Read-only view of one factory at inspection time. Never a default: failure is `unavailable`. */
export async function loadForecastCapacitySnapshot(factoryId: string): Promise<ForecastCapacitySnapshot> {
  try {
    const [models, processes, machines] = await Promise.all([
      supabaseAdmin.from('product_models').select('id, model_name, is_active').eq('factory_id', factoryId).order('model_name').limit(SNAPSHOT_LIMIT),
      supabaseAdmin.from('model_processes').select('id, model_id, process_name, process_order, tact_time_seconds').eq('factory_id', factoryId).order('process_order').limit(SNAPSHOT_LIMIT),
      supabaseAdmin.from('machines').select('id, name, location, is_active, production_model_id, current_process_id').eq('factory_id', factoryId).order('name').limit(SNAPSHOT_LIMIT),
    ]);
    if (models.error || processes.error || machines.error) return { status: 'unavailable' };
    const rows = { models: (models.data ?? []) as ModelRow[], processes: (processes.data ?? []) as ProcessRow[], machines: (machines.data ?? []) as MachineRow[] };
    if (Object.values(rows).some(list => list.length >= SNAPSHOT_LIMIT)) return { status: 'unavailable' };
    const byModel = new Map<string, ForecastSnapshotModel>(rows.models.map(m => [m.id, { id: m.id, name: m.model_name, isActive: m.is_active, processes: [] }]));
    for (const p of rows.processes) byModel.get(p.model_id)?.processes.push({ id: p.id, name: p.process_name, order: p.process_order, tactTimeSeconds: p.tact_time_seconds });
    return {
      status: 'available', takenAt: new Date().toISOString(), models: [...byModel.values()],
      machines: rows.machines.map(m => ({ id: m.id, name: m.name, location: m.location ?? '', isActive: m.is_active, modelId: m.production_model_id, processId: m.current_process_id })),
    };
  } catch { return { status: 'unavailable' }; }
}
