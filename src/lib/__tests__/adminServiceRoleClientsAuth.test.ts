import fs from 'fs';
import path from 'path';

const protectedClients = [
  {
    file: 'src/hooks/useAdminOperations.ts',
    endpoints: ['/api/admin/users'],
  },
  {
    file: 'src/components/machines/MachinesBulkUpload.tsx',
    endpoints: ['/api/admin/machines/bulk-upload'],
  },
  {
    file: 'src/app/admin/setup-user/page.tsx',
    endpoints: ['/api/admin/setup-real-user'],
  },
];

describe('admin service-role clients', () => {
  it.each(protectedClients)('$file sends protected requests through authFetch', ({ file, endpoints }) => {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');

    expect(source).toMatch(/import \{ authFetch \} from '@\/lib\/authFetch'/);
    for (const endpoint of endpoints) {
      expect(source).toContain(`authFetch('${endpoint}`);
      expect(source).not.toContain(`fetch('${endpoint}`);
    }
  });
});
