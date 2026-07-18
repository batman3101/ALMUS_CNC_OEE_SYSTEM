import fs from 'fs';
import path from 'path';

const mutationClients = [
  'src/hooks/useProductionRecords.ts',
  'src/hooks/useRealtimeProductionRecords.ts',
  'src/hooks/useRealtimeMachines.ts',
  'src/components/production/ProductionRecordList.tsx',
  // OperatorDashboard 는 더 이상 직접 변이하지 않는다(상태변경·생산실적 제거). 변이는 아래 운영자 콘솔 파일·훅으로 이관됨.
  'src/hooks/useMachineDowntime.ts',
  'src/components/dashboard/operator-console/ProgressInputSection.tsx',
  'src/components/dashboard/operator-console/CloseShiftSection.tsx',
  'src/components/dashboard/operator-console/DefectPendingSection.tsx',
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
