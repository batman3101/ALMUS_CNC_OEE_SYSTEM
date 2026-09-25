import type { ForecastSnapshotModel } from '@/types/forecast';
import { matchModels, normalizeModelName, normalizeProcessName } from '../modelAliases';

const model = (id: string, name: string, processes: Array<[string, number, number | null]>, isActive = true): ForecastSnapshotModel => ({
  id, name, isActive, processes: processes.map(([pname, order, tact], i) => ({ id: `${id}-p${i}`, name: pname, order, tactTimeSeconds: tact })),
});
const db = [
  model('h8m', 'H8 M', [['CNC #0', 1, 63], ['CNC #1', 2, 593], ['CNC #2', 3, 453]]),
  model('h8m-old', 'H8M', [['CNC #1', 1, 593]], false),
  model('dm3', 'DM 3', [['CNC # 1', 1, 630], ['CNC # 2', 2, 796]]),
  model('on1', 'ON1', [['CNC #1', 1, 560], ['CNC #2', 2, 558]]),
  model('pa3', 'PA3', [['CNC #1', 1, 1391], ['CNC #2', 2, 1197], ['CNC #2-1', 3, 409]]),
  model('zero', 'ZERO', [['CNC #1', 1, 0], ['CNC #2', 2, null]]),
];

describe('model and process name matching', () => {
  it('normalizes spacing and case', () => {
    expect(normalizeModelName(' On 1 ')).toBe('ON1');
    expect(normalizeModelName('Canvas 2')).toBe('CANVAS2');
  });
  it('recognizes CNC0, CNC1 and CNC2 process names in their spelling variants', () => {
    expect(normalizeProcessName('CNC #1')).toBe('CNC1');
    expect(normalizeProcessName('CNC # 2')).toBe('CNC2');
    expect(normalizeProcessName('CNC #0')).toBe('CNC0');
    expect(normalizeProcessName('CNC # 0')).toBe('CNC0');
    expect(normalizeProcessName('CNC #2-1')).toBeNull();
  });
  it('matches by normalized name and by alias, skipping inactive models', () => {
    const matches = matchModels(['ON 1', 'H8 MAIN', 'Diamond3', 'Hubble Y2'], db);
    expect(matches.get('ON 1')).toMatchObject({ reason: 'matched', dbModel: { id: 'on1' } });
    expect(matches.get('H8 MAIN')).toMatchObject({ reason: 'alias', dbModel: { id: 'h8m' } });
    expect(matches.get('Diamond3')).toMatchObject({ reason: 'alias', dbModel: { id: 'dm3' } });
    expect(matches.get('Hubble Y2')).toMatchObject({ reason: 'unmapped', dbModel: null });
  });
  it('resolves CNC0/CNC1/CNC2 process ids and tact time per model', () => {
    const h8 = matchModels(['H8 MAIN'], db).get('H8 MAIN')!;
    // Short CNC #0 tact is real for H8 (confirmed by the factory 2026-09-25), not a data error.
    expect(h8.processes.CNC0).toEqual({ id: 'h8m-p0', tactTimeSeconds: 63 });
    expect(h8.processes.CNC1).toEqual({ id: 'h8m-p1', tactTimeSeconds: 593 });
    expect(h8.processes.CNC2).toEqual({ id: 'h8m-p2', tactTimeSeconds: 453 });
    const dm = matchModels(['Diamond3'], db).get('Diamond3')!;
    expect(dm.processes.CNC1).toEqual({ id: 'dm3-p0', tactTimeSeconds: 630 });
    expect(dm.processes.CNC0).toBeNull();
  });
  it('keeps a missing process as null instead of borrowing another process', () => {
    const single = matchModels(['ONLY'], [model('only', 'ONLY', [['CNC #1', 1, 100]])]).get('ONLY')!;
    expect(single.processes).toEqual({ CNC0: null, CNC1: { id: 'only-p0', tactTimeSeconds: 100 }, CNC2: null });
  });
  it('refuses an ambiguous match when two active models normalize to the same name', () => {
    const twins = [model('a', 'B7 SUB', [['CNC #1', 1, 1]]), model('b', 'B7SUB', [['CNC #1', 1, 1]])];
    expect(matchModels(['B7 Sub'], twins).get('B7 Sub')).toMatchObject({ reason: 'ambiguous', dbModel: null });
  });
});
