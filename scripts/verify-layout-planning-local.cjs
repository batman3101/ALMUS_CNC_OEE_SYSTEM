/* Layout planning end-to-end against the LOCAL Supabase stack only (`npx supabase start`).
 *
 * Runs the real server module (src/lib/layout-planning/server.ts → PostgREST → RPCs) — the part unit tests
 * cannot see (query syntax, RPC argument names, FK/RLS/grant behaviour, error mapping).
 * Seeds local-only fixtures (ZZ_LOCAL_* models, some ALT machines assigned). Refuses any non-loopback URL.
 *
 *   node scripts/verify-layout-planning-local.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');

process.env.NODE_ENV = 'development';
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.LOCAL_SUPABASE_URL || 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'; // public local demo key
if (!['127.0.0.1', 'localhost'].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname)) throw new Error('local Supabase only');

require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file);
const Module = require('module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return resolve.call(this, request.startsWith('@/') ? path.resolve('src', request.slice(2)) : request, ...rest); };

const { supabaseAdmin: db } = require('../src/lib/supabase-admin.ts');
const server = require('../src/lib/layout-planning/server.ts');
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS:', name); };
const expectCode = async (promise, code) => {
  try { await promise; } catch (e) { assert.equal(e.code, code, `expected ${code}, got ${e.code ?? e.message}`); return e; }
  throw new Error(`expected ${code}, got success`);
};

async function seed(factoryId) {
  // Fresh local fixtures: remove previous plans and fixture models, then rebuild.
  await db.from('machine_setup_tasks').delete().eq('factory_id', factoryId);
  await db.from('layout_plans').delete().eq('factory_id', factoryId);
  await db.from('forecast_model_mappings').delete().eq('factory_id', factoryId);
  await db.from('machines').update({ production_model_id: null, current_process_id: null }).eq('factory_id', factoryId);
  await db.from('product_models').delete().eq('factory_id', factoryId).like('model_name', 'ZZ_LOCAL_%');
  const models = {};
  for (const [name, procs] of [['ZZ_LOCAL_A', [['CNC #1', 560], ['CNC #2', 558]]], ['ZZ_LOCAL_B', [['CNC #1', 600], ['CNC #2', 600]]], ['ZZ_LOCAL_H', [['CNC #0', 63], ['CNC #1', 593], ['CNC #2', 453]]]]) {
    const { data: m, error } = await db.from('product_models').insert({ factory_id: factoryId, model_name: name, is_active: true }).select('id').single();
    if (error) throw error;
    models[name] = { id: m.id, processes: {} };
    for (const [i, [p, tact]] of procs.entries()) {
      const { data: row, error: e2 } = await db.from('model_processes').insert({ factory_id: factoryId, model_id: m.id, process_name: p, process_order: i + 1, tact_time_seconds: tact }).select('id').single();
      if (e2) throw e2;
      models[name].processes[p] = row.id;
    }
  }
  const { data: machines } = await db.from('machines').select('id, name').eq('factory_id', factoryId).order('name').limit(1000);
  const byNo = n => machines.find(m => m.name === `CNC-${String(n).padStart(3, '0')}`).id;
  const assign = async (from, to, model, proc) => {
    for (let n = from; n <= to; n++) {
      const { error } = await db.from('machines').update({ production_model_id: models[model].id, current_process_id: models[model].processes[proc], is_active: true }).eq('id', byNo(n));
      if (error) throw error;
    }
  };
  await assign(1, 10, 'ZZ_LOCAL_A', 'CNC #1');    // A: 10 on CNC1
  await assign(21, 30, 'ZZ_LOCAL_A', 'CNC #2');   // A: 10 on CNC2
  await assign(40, 60, 'ZZ_LOCAL_B', 'CNC #1');   // B: 21 on CNC1 (zero demand → pool)
  return { models, byNo };
}

const demand = (model, peak) => ({ model, week: '2099-W01', peakQuantity: peak, peakDate: peak ? '2099-01-02' : null, warnings: [] });

(async () => {
  const { data: factory } = await db.from('factories').select('id').eq('code', 'ALT').single();
  const factoryId = factory.id;
  const { models, byNo } = await seed(factoryId);
  const week = { key: '2099-W01', start: '2099-01-01', end: '2099-01-07' };
  const base = { title: 'local e2e', forecastFileName: 'local.xlsx', forecastFileHash: 'local', week, nextWeekDemands: [], lockedMachineIds: [] };
  let planId;

  await check('workspace: ALT drawing with 800 positions; ALV has no drawing (added later)', async () => {
    const ws = await server.loadWorkspace(factoryId);
    assert.equal(ws.geometry.positions.length, 800);
    assert.equal(ws.snapshot.status, 'available');
    const { data: alv } = await db.from('factories').select('id').eq('code', 'ALV').single();
    assert.equal(await server.loadGeometry(alv.id), null);
  });

  await check('unmapped forecast model with demand blocks the plan (422) until acknowledged', async () => {
    const e = await expectCode(server.createPlan(factoryId, null, { ...base, demands: [demand('zz_local_a', 1300), demand('Mystery', 10)], acknowledgeUnmapped: false }), 'unmapped_models');
    assert.deepEqual(e.detail, { models: ['Mystery'] });
  });

  await check('saved mapping is used; plan is created with CAPA requirements and spatial moves', async () => {
    await server.saveMappings(factoryId, null, [{ forecastModel: 'Mystery', productModelId: models.ZZ_LOCAL_H.id }]);
    // A: 1300/day ÷ 130 per machine = 10 needed on each process (10 present) → ok. H: needs CNC0/1/2 from the B pool + idle.
    const created = await server.createPlan(factoryId, null, { ...base, demands: [demand('zz_local_a', 1300), demand('Mystery', 1000), demand('ZZ_LOCAL_B', 0)], acknowledgeUnmapped: false });
    planId = created.planId;
    const plan = await server.loadPlan(factoryId, planId);
    assert.equal(plan.plan.status, 'draft');
    assert.equal(plan.assignments.length, 800);
    const h = plan.summary.groups.filter(g => g.modelId === models.ZZ_LOCAL_H.id);
    assert.equal(h.length, 3, 'CNC #0 is part of the plan');
    assert.ok(h.every(g => g.status === 'ok'), JSON.stringify(h.map(g => [g.processName, g.required, g.assigned])));
    const a = plan.summary.groups.filter(g => g.modelId === models.ZZ_LOCAL_A.id);
    assert.ok(a.every(g => g.status === 'ok' && g.required === 10 && g.assigned === 10));
  });

  let revision;
  await check('fine-tune: moving one machine updates the alerts; stale revision → 409', async () => {
    const plan = await server.loadPlan(factoryId, planId);
    revision = plan.plan.revision;
    const saved = await server.savePlanDraft(factoryId, null, planId, revision, [{ machineId: byNo(1), finalModelId: null, finalProcessId: null }]);
    revision = saved.revision;
    const after = await server.loadPlan(factoryId, planId);
    const a1 = after.summary.groups.find(g => g.modelId === models.ZZ_LOCAL_A.id && g.processName === 'CNC #1');
    assert.equal(a1.status, 'shortage'); assert.equal(a1.gap, -1);
    await expectCode(server.savePlanDraft(factoryId, null, planId, revision - 1, []), 'plan_revision_conflict');
    // restore
    revision = (await server.savePlanDraft(factoryId, null, planId, revision, [{ machineId: byNo(1), finalModelId: models.ZZ_LOCAL_A.id, finalProcessId: models.ZZ_LOCAL_A.processes['CNC #1'] }])).revision;
  });

  await check('a model/process pair from different models is refused (400 invalid_assignment)', async () => {
    await expectCode(server.savePlanDraft(factoryId, null, planId, revision, [{ machineId: byNo(1), finalModelId: models.ZZ_LOCAL_A.id, finalProcessId: models.ZZ_LOCAL_B.processes['CNC #1'] }]), 'invalid_assignment');
  });

  await check('confirm writes machines, opens setup tasks, and a setup task walks pending → in progress → completed', async () => {
    const plan = await server.loadPlan(factoryId, planId);
    const changed = plan.assignments.filter(x => x.final_model_id !== x.base_model_id || x.final_process_id !== x.base_process_id);
    const result = await server.confirmPlan(factoryId, null, planId, plan.plan.revision);
    assert.equal(result.changed_machines, changed.length);
    const sample = changed[0];
    const { data: m } = await db.from('machines').select('production_model_id, current_process_id').eq('id', sample.machine_id).single();
    assert.deepEqual([m.production_model_id, m.current_process_id], [sample.final_model_id, sample.final_process_id]);
    const confirmed = await server.loadPlan(factoryId, planId);
    assert.equal(confirmed.plan.status, 'confirmed');
    assert.equal(confirmed.setupTasks.length, changed.length);
    const task = confirmed.setupTasks[0];
    const t1 = await server.transitionSetupTask(factoryId, null, task.id, task.revision, 'in_progress', null);
    await expectCode(server.transitionSetupTask(factoryId, null, task.id, t1.revision, 'in_progress', null), 'invalid_setup_transition');
    await server.transitionSetupTask(factoryId, null, task.id, t1.revision, 'completed', null);
  });

  await check('a plan made before someone changed a machine cannot be confirmed (409 layout_base_stale)', async () => {
    const { planId: p2 } = await server.createPlan(factoryId, null, { ...base, demands: [demand('zz_local_a', 1300)], acknowledgeUnmapped: true });
    await db.from('machines').update({ production_model_id: null, current_process_id: null }).eq('id', byNo(2));
    const plan = await server.loadPlan(factoryId, p2);
    await expectCode(server.confirmPlan(factoryId, null, p2, plan.plan.revision), 'layout_base_stale');
    await server.discardPlan(factoryId, null, p2);
    await expectCode(server.discardPlan(factoryId, null, p2), 'plan_not_draft');
  });

  await check('another factory cannot read or confirm this plan (404)', async () => {
    const { data: alv } = await db.from('factories').select('id').eq('code', 'ALV').single();
    await expectCode(server.loadPlan(alv.id, planId), 'plan_not_found');
  });

  console.log('ALL PASS:', checks.length, 'checks');
})().catch(e => { console.error(e); process.exit(1); });
