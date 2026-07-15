import fs from 'fs';
import path from 'path';

const mutationClients = [
  'src/hooks/useProductionRecords.ts',
  'src/hooks/useRealtimeProductionRecords.ts',
  'src/hooks/useRealtimeMachines.ts',
  'src/components/production/ProductionRecordList.tsx',
  'src/components/dashboard/OperatorDashboard.tsx',
  'src/components/machines/MachineEditModal.tsx',
  'src/components/data-input/ShiftDataInputForm.tsx',
];

describe('authenticated mutation clients', () => {
  it.each(mutationClients)('%s sends protected mutations through authFetch', file => {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    expect(source).toMatch(/import \{ authFetch \} from '@\/lib\/authFetch'/);
    expect(source).toContain('authFetch(');
  });
});
