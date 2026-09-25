const from = jest.fn();
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: (...args: unknown[]) => from(...args) } }));
import { SNAPSHOT_LIMIT, loadForecastCapacitySnapshot } from '../capacitySnapshot';

type Row = Record<string, unknown>;
function table(data: Row[] | null, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit']) builder[method] = jest.fn(() => builder);
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve);
  return builder as Record<string, jest.Mock> & { then: unknown };
}

describe('factory capacity snapshot', () => {
  beforeEach(() => jest.clearAllMocks());
  it('reads models, processes and machines of one factory only and nests processes under models', async () => {
    const tables: Record<string, ReturnType<typeof table>> = {
      product_models: table([{ id: 'm1', model_name: 'ON1', is_active: true }]),
      model_processes: table([{ id: 'p1', model_id: 'm1', process_name: 'CNC #1', process_order: 1, tact_time_seconds: 560 }, { id: 'p9', model_id: 'ghost', process_name: 'CNC #1', process_order: 1, tact_time_seconds: 1 }]),
      machines: table([{ id: 'x', name: 'CNC-001', location: 'A동', is_active: true, production_model_id: 'm1', current_process_id: 'p1' }]),
    };
    from.mockImplementation((name: string) => tables[name]);
    const snapshot = await loadForecastCapacitySnapshot('factory-1');
    expect(snapshot).toMatchObject({ status: 'available', models: [{ id: 'm1', name: 'ON1', isActive: true, processes: [{ id: 'p1', name: 'CNC #1', order: 1, tactTimeSeconds: 560 }] }], machines: [{ id: 'x', name: 'CNC-001', location: 'A동', isActive: true, modelId: 'm1', processId: 'p1' }] });
    for (const t of Object.values(tables)) expect(t.eq).toHaveBeenCalledWith('factory_id', 'factory-1');
  });
  it('reports unavailable on any query error instead of a partial snapshot', async () => {
    from.mockImplementation((name: string) => name === 'machines' ? table(null, { message: 'boom' }) : table([]));
    expect(await loadForecastCapacitySnapshot('factory-1')).toEqual({ status: 'unavailable' });
  });
  it('refuses a result that may have been truncated at the row limit', async () => {
    from.mockImplementation((name: string) => name === 'machines' ? table(Array.from({ length: SNAPSHOT_LIMIT }, (_, i) => ({ id: String(i), name: 'CNC', location: '', is_active: true, production_model_id: null, current_process_id: null }))) : table([]));
    expect(await loadForecastCapacitySnapshot('factory-1')).toEqual({ status: 'unavailable' });
  });
});
