const mockBreaks = jest.fn();
const mockConfig = jest.fn();
jest.mock('@/lib/plannedRuntime', () => ({ getBreakTimeMinutes: (...args: unknown[]) => mockBreaks(...args) }));
jest.mock('@/lib/shiftConfig', () => ({ getBusinessTimeConfig: (...args: unknown[]) => mockConfig(...args) }));
import { loadForecastCapacityPolicy } from '../capacityPolicy';

describe('Forecast reuses OEE settings', () => {
  beforeEach(() => { jest.clearAllMocks(); mockBreaks.mockResolvedValue(110); mockConfig.mockResolvedValue({ timezone: 'Asia/Ho_Chi_Minh', shiftAStart: '08:00', shiftBStart: '20:00' }); });
  it('uses factory-scoped existing readers and does not add an efficiency multiplier', async () => {
    expect(await loadForecastCapacityPolicy('factory-2')).toMatchObject({ status: 'available', breakMinutes: 110, separateEfficiencyMultiplier: false });
    expect(mockBreaks).toHaveBeenCalledWith('factory-2'); expect(mockConfig).toHaveBeenCalledWith('factory-2');
  });
  it('preserves explicit zero breaks', async () => {
    mockBreaks.mockResolvedValue(0); expect(await loadForecastCapacityPolicy('factory-1')).toMatchObject({ breakMinutes: 0 });
  });
  it('does not disguise settings failures as 60 minutes', async () => {
    mockBreaks.mockRejectedValue(new Error('DB unavailable')); expect(await loadForecastCapacityPolicy('factory-1')).toEqual({ status: 'unavailable' });
  });
  it.each(['30:00', '08:00'])('blocks invalid/identical shift boundaries %s', async shiftBStart => {
    mockConfig.mockResolvedValue({ timezone: 'Asia/Ho_Chi_Minh', shiftAStart: '08:00', shiftBStart });
    expect(await loadForecastCapacityPolicy('factory-1')).toEqual({ status: 'unavailable' });
  });
});
