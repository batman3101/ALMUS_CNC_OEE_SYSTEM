jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {} }));
jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));

import { InvalidMachineUpdateError, pickMachineUpdates } from '../machineUpdate';

describe('BUG-016 machine update validation', () => {
  it('accepts JSON booleans including false', () => {
    expect(pickMachineUpdates({ is_active: false })).toEqual({ is_active: false });
  });

  it.each([{ is_active: 'false' }, { is_active: 0 }, { is_active: null }])(
    'rejects non-boolean is_active: %p',
    body => expect(() => pickMachineUpdates(body)).toThrow(InvalidMachineUpdateError)
  );

  it.each([{ name: null }, { name: '' }, { name: '   ' }])(
    'rejects invalid name: %p',
    body => expect(() => pickMachineUpdates(body)).toThrow(InvalidMachineUpdateError)
  );

  it('trims required and nullable string fields', () => {
    expect(pickMachineUpdates({
      name: ' CNC-01 ',
      current_state: ' NORMAL_OPERATION ',
      location: null,
      equipment_type: ' Lathe ',
    })).toEqual({
      name: 'CNC-01',
      current_state: 'NORMAL_OPERATION',
      location: null,
      equipment_type: 'Lathe',
    });
  });
});
