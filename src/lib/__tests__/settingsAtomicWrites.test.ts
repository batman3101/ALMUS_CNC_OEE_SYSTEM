const mockGetSession = jest.fn();
const mockBroadcast = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
    channel: () => ({ send: (...args: unknown[]) => mockBroadcast(...args) }),
  },
}));

import { SystemSettingsService } from '../systemSettings';
import { SETTINGS_REGISTRY } from '../settingsRegistry';
import { TOTAL_BREAK_MINUTES } from '@/utils/shiftBreaks';

/**
 * 2026-08-06 감사 HIGH-01 / HIGH-05 회귀 검사.
 *
 * **이 파일의 단언은 반환값이 아니라 요청 수다.** 이유가 전부다 — 예전 구현
 * (`Promise.all(updates.map(updateSetting))`)도 모두 성공하면 `{success:true}` 를 돌려준다.
 * 반환값만 보는 테스트는 깨진 구현에서 그대로 통과하므로 아무것도 지키지 못한다.
 * 원자성이 실제로 관찰되는 지점은 "요청이 N 번인가 1 번인가"이고, 그것만이 부분 실패가
 * 가능한지 아닌지를 가른다.
 */

interface CapturedBody {
  updates?: Array<{ category: string; setting_key: string; setting_value: string }>;
  change_reason?: string;
}

const mockFetch = jest.fn();

const capturedBody = (call: number): CapturedBody =>
  JSON.parse(mockFetch.mock.calls[call][1].body as string) as CapturedBody;

describe('설정 일괄 저장은 요청 한 번이다', () => {
  const service = SystemSettingsService.getInstance();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'admin-token' } } });
    mockBroadcast.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
  });

  it('resetToDefaults 는 계약 전체를 배치 요청 한 번으로 쓴다', async () => {
    const result = await service.resetToDefaults();

    expect(result.success).toBe(true);
    // 예전에는 32번이었다. 중간에 실패하면 "일부만 초기화된" 상태가 남는데, 초기화의 존재
    // 이유가 정확히 그 반대(알 수 없는 상태 → 아는 상태)라 부분 실패는 기능을 무의미하게 만든다.
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const body = capturedBody(0);
    expect(body.updates).toHaveLength(SETTINGS_REGISTRY.length);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/system-settings/update');
  });

  it('초기화가 쓰는 휴식 시간은 실시간 계산이 지원하는 값이다', async () => {
    await service.resetToDefaults();

    const breakUpdate = capturedBody(0).updates?.find(u => u.setting_key === 'break_time_minutes');
    // 예전 기본값 60 이 저장되면 /api/production-progress 가 break_config_matches:false 로
    // 안전 중단해 설비 콘솔의 실시간 지표가 전 설비에서 사라진다(감사 HIGH-01).
    expect(breakUpdate?.setting_value).toBe(String(TOTAL_BREAK_MINUTES));
  });

  it('초기화가 제거된 교대 종료 시각을 되살리지 않고 현행 키를 빠뜨리지 않는다', async () => {
    await service.resetToDefaults();

    const keys = capturedBody(0).updates?.map(u => `${u.category}.${u.setting_key}`) ?? [];
    expect(keys).not.toContain('shift.shift_a_end');
    expect(keys).not.toContain('shift.shift_b_end');
    expect(keys).toContain('shift.shift_change_buffer_minutes');
    expect(keys).toContain('notification.notification_email');
  });

  it('카테고리 초기화도 요청 한 번이며 그 카테고리만 담는다', async () => {
    const result = await service.resetToDefaults('shift');

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const updates = capturedBody(0).updates ?? [];
    expect(updates).toHaveLength(4);
    expect(updates.every(u => u.category === 'shift')).toBe(true);
  });

  it('updateMultipleSettings 는 항목이 몇 개든 요청 한 번으로 보낸다', async () => {
    const result = await service.updateMultipleSettings([
      { category: 'general', setting_key: 'company_name', setting_value: 'ALMUS TECH', change_reason: '일반 설정 업데이트' },
      { category: 'general', setting_key: 'timezone', setting_value: 'Asia/Seoul' },
      { category: 'general', setting_key: 'default_language', setting_value: 'vi' },
    ]);

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(capturedBody(0).updates).toHaveLength(3);
    expect(capturedBody(0).change_reason).toBe('일반 설정 업데이트');
  });

  it('배치가 실패하면 사유를 그대로 전하고 재시도로 쪼개지 않는다', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: '설정 업데이트 실패: deadlock detected' }),
    });

    const result = await service.updateMultipleSettings([
      { category: 'display', setting_key: 'compact_mode', setting_value: true },
      { category: 'display', setting_key: 'theme_mode', setting_value: 'dark' },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('deadlock detected');
    // 실패를 개별 저장으로 되받으면 부분 반영이 되살아난다.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('계약 밖 키는 요청을 보내기 전에 막는다', async () => {
    const result = await service.updateMultipleSettings([
      { category: 'general', setting_key: 'company_name', setting_value: 'ALMUS TECH' },
      // 라이브에 남아 있는 레거시 키. 현행 키는 display.theme_mode 다.
      { category: 'display', setting_key: 'theme', setting_value: 'dark' },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('display.theme');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
