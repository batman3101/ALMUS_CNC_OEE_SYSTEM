jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import {
  DEFAULT_OPERATING_MINUTES,
  resolvePlannedRuntime,
} from '../plannedRuntime';

describe('resolvePlannedRuntime', () => {
  it('uses the default only when operating minutes are missing', () => {
    expect(resolvePlannedRuntime(undefined, 60)).toBe(DEFAULT_OPERATING_MINUTES - 60);
    expect(resolvePlannedRuntime(null, 60)).toBe(DEFAULT_OPERATING_MINUTES - 60);
  });

  it('preserves an explicitly scheduled zero-minute shift', () => {
    expect(resolvePlannedRuntime(0, 60)).toBe(0);
  });
});
