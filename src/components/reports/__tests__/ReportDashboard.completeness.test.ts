import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ReportDashboard completeness contract', () => {
  const dashboard = readFileSync(
    resolve(process.cwd(), 'src/components/reports/ReportDashboard.tsx'),
    'utf8'
  );
  const page = readFileSync(resolve(process.cwd(), 'src/app/reports/page.tsx'), 'utf8');

  it('calculates OEE only from complete rows while keeping all production totals', () => {
    expect(dashboard).toMatch(/productionRecords\.filter\(record\s*=>/);
    expect(dashboard).toMatch(/record\.planned_runtime != null/);
    expect(dashboard).toMatch(/reportedRecords/);
    expect(dashboard).toMatch(/totalRecords/);
    expect(dashboard).toMatch(/oeeByRecordId/);
    expect(dashboard).toMatch(/oeeByRecordId\.get\(record\.record_id\)/);
    expect(dashboard).toMatch(/calculateWeightedOEE/);
    expect(dashboard).toMatch(/avgOEE:\s*number \| null/);
    expect(dashboard).toMatch(/stats\.avgOEE === null \? '—'/);
    expect(dashboard).toMatch(/totalOutput:\s*productionTotals\.output/);
  });

  it('does not render summary cards from a truncated raw dataset', () => {
    expect(dashboard).toMatch(/isDataComplete && !dataError/);
  });

  it('lifts the machine selection into the server query scope', () => {
    expect(page).toMatch(/selectedMachineIds/);
    expect(page).toMatch(/machineId:\s*selectedMachineIds\[0\]/);
    expect(dashboard).toMatch(/onSelectedMachinesChange/);
    expect(dashboard).not.toMatch(/mode="multiple"/);
  });

  it('includes inactive machines in long-range report selection', () => {
    expect(page).toMatch(/fetchMachines\(\{ includeInactive: true \}\)/);
  });
});
