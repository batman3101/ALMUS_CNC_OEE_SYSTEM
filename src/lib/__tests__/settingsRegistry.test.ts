import {
  SETTINGS_REGISTRY,
  SETTINGS_CONTRACT_IDS,
  findSettingEntry,
  isContractKey,
  settingsForCategory,
  validateSettingValue,
} from '../settingsRegistry';
import { TOTAL_BREAK_MINUTES } from '@/utils/shiftBreaks';
import { DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES } from '../shiftDefaults';

/**
 * 2026-08-06 감사 HIGH-01 / 5.2 회귀 검사.
 *
 * 감사가 찾아낸 것은 "레지스트리가 32개, 라이브 DB 도 32개인데 **같은 32개가 아니다**" 였다.
 * 개수만 세는 검사는 그 상태를 통과시킨다 — 실제로 아무도 몇 년째 눈치채지 못했다.
 * 그래서 아래는 32개 키를 **하나하나 적어** 대조한다. 계약이 바뀌면 이 목록도 같이 바뀌어야
 * 하고, 그 순간이 바로 "화면·DB·초기화를 같이 맞췄는가"를 사람이 확인해야 하는 지점이다.
 */

/** 현행 설정 계약. 순서는 관계없다 — 집합으로 비교한다. */
const CONTRACT = [
  'general.company_name',
  'general.company_logo_url',
  'general.timezone',
  'general.date_format',
  'general.time_format',
  'general.default_language',

  'oee.target_oee',
  'oee.target_availability',
  'oee.target_performance',
  'oee.target_quality',
  'oee.low_oee_threshold',
  'oee.critical_oee_threshold',
  'oee.downtime_alert_minutes',

  'shift.shift_a_start',
  'shift.shift_b_start',
  'shift.break_time_minutes',
  'shift.shift_change_buffer_minutes',

  'notification.email_notifications_enabled',
  'notification.browser_notifications_enabled',
  'notification.sound_notifications_enabled',
  'notification.notification_email',
  'notification.alert_check_interval_seconds',

  'display.theme_mode',
  'display.theme_primary_color',
  'display.theme_success_color',
  'display.theme_warning_color',
  'display.theme_error_color',
  'display.dashboard_refresh_interval_seconds',
  'display.chart_animation_enabled',
  'display.compact_mode',
  'display.show_machine_images',
  'display.sidebar_collapsed',
];

describe('설정 원장 — 키 집합이 곧 계약이다', () => {
  it('계약 키는 정확히 32개이며 목록과 완전히 일치한다', () => {
    expect(CONTRACT).toHaveLength(32);
    expect([...SETTINGS_CONTRACT_IDS].sort()).toEqual([...CONTRACT].sort());
  });

  it('키가 중복되지 않는다', () => {
    // 중복이 있으면 lookup 이 뒤엣것으로 덮이고, 초기화는 같은 키를 두 번 쓴다.
    expect(new Set(SETTINGS_CONTRACT_IDS).size).toBe(SETTINGS_REGISTRY.length);
  });

  it('제거된 교대 종료 시각을 되살리지 않는다', () => {
    // d0da963(2026-07-29)에서 화면과 서버 양쪽에서 사라졌지만 초기화 레지스트리에만 남아
    // 있었다. 초기화를 누르면 서버가 읽지도 않는 키가 DB 에 다시 생겼다.
    expect(isContractKey('shift', 'shift_a_end')).toBe(false);
    expect(isContractKey('shift', 'shift_b_end')).toBe(false);
  });

  it('같은 변경에서 중요해진 키와 알림 이메일이 계약에 들어 있다', () => {
    // 이 둘이 빠져 있어서 초기화는 32개 계약 중 30개만 덮었다.
    expect(isContractKey('shift', 'shift_change_buffer_minutes')).toBe(true);
    expect(isContractKey('notification', 'notification_email')).toBe(true);
    expect(findSettingEntry('notification', 'notification_email')?.defaultValue).toBe('');
  });

  it('라이브에 쌓인 레거시 키는 계약이 아니다', () => {
    // 2026-08-06 감사 5.1 의 활성 레거시 11개. 저장 API 가 이들을 거부해야 더 쌓이지 않는다.
    const legacy = [
      ['display', 'refresh_interval'],
      ['display', 'theme'],
      ['general', 'test_setting'],
      ['notification', 'email_enabled'],
      ['oee', 'availability_target'],
      ['oee', 'oee_target_percentage'],
      ['oee', 'performance_target'],
      ['oee', 'quality_target'],
      ['shift', 'shift_a_end'],
      ['shift', 'shift_b_end'],
      ['ui', 'language'],
    ];
    for (const [category, key] of legacy) {
      expect(isContractKey(category, key)).toBe(false);
    }
  });

  it('카테고리별 개수가 설정 화면의 탭 구성과 같다', () => {
    expect(settingsForCategory('general')).toHaveLength(6);
    expect(settingsForCategory('oee')).toHaveLength(7);
    expect(settingsForCategory('shift')).toHaveLength(4);
    expect(settingsForCategory('notification')).toHaveLength(5);
    expect(settingsForCategory('display')).toHaveLength(10);
  });
});

describe('기본값은 원천에서 온다 — 리터럴로 다시 적지 않는다', () => {
  it('휴식 기본값은 실시간 계산이 쓰는 TOTAL_BREAK_MINUTES 와 같다', () => {
    // 예전 기본값은 60분이었다. 운영값 110분과 어긋나 있었고, "모든 설정 초기화"가 그 60을
    // 써 넣으면 /api/production-progress 가 break_config_matches:false 로 안전 중단해
    // 설비 콘솔의 실시간 지표가 전 설비에서 사라진다(감사 HIGH-01).
    //
    // 이 단언은 리터럴 110 을 쓰지 않는다. 리터럴로 적으면 shiftBreaks 가 바뀔 때 이 테스트가
    // "옛 숫자"를 지키는 쪽이 되어, 정작 막으려던 드리프트를 다시 만든다.
    expect(findSettingEntry('shift', 'break_time_minutes')?.defaultValue).toBe(TOTAL_BREAK_MINUTES);
  });

  it('전환 유예 기본값은 화면·서버가 공유하는 상수와 같다', () => {
    expect(findSettingEntry('shift', 'shift_change_buffer_minutes')?.defaultValue)
      .toBe(DEFAULT_SHIFT_CHANGE_BUFFER_MINUTES);
  });

  it('모든 기본값이 자기 자신의 검증을 통과한다', () => {
    // 통과하지 못하는 기본값이 있으면 초기화가 스스로 400 을 맞는다. 계약이 자기모순인
    // 상태이므로 개별 항목보다 이 불변조건이 먼저다.
    for (const entry of SETTINGS_REGISTRY) {
      const result = validateSettingValue(entry.category, entry.key, entry.defaultValue);
      expect(result.ok ? null : result.error).toBeNull();
    }
  });
});

describe('validateSettingValue — 키·자료형·범위·선택지', () => {
  it('계약 밖 키는 키 이름을 담아 거부한다', () => {
    const result = validateSettingValue('shift', 'shift_a_end', '20:00');
    expect(result.ok).toBe(false);
    // 메시지가 어느 키인지 말하지 않으면 관리자는 같은 요청을 계속 보낸다.
    expect(result.ok ? '' : result.error).toContain('shift.shift_a_end');
  });

  it('전선 위의 문자열 숫자를 숫자로 해석한다', () => {
    // 저장 경로는 값을 텍스트로 보낸다(JSON.stringify → String). 여기서 해석하지 않으면
    // 정상 저장이 전부 자료형 오류가 된다.
    expect(validateSettingValue('shift', 'break_time_minutes', '110')).toEqual({ ok: true, value: 110 });
    expect(validateSettingValue('notification', 'sound_notifications_enabled', 'false'))
      .toEqual({ ok: true, value: false });
  });

  it('숫자 자리에 숫자가 아닌 값이 오면 거부한다', () => {
    const result = validateSettingValue('shift', 'break_time_minutes', 'abc');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('숫자');
  });

  it('범위를 벗어난 값을 거부한다', () => {
    const tooBig = validateSettingValue('shift', 'break_time_minutes', 9999);
    expect(tooBig.ok).toBe(false);
    expect(tooBig.ok ? '' : tooBig.error).toContain('240');

    const tooSmall = validateSettingValue('notification', 'alert_check_interval_seconds', 1);
    expect(tooSmall.ok).toBe(false);
    expect(tooSmall.ok ? '' : tooSmall.error).toContain('10');
  });

  it('0 은 합법적인 값이다 — falsy 라고 거부하지 않는다', () => {
    // 관리자는 휴식 없음(0)과 유예 없음(0)을 명시적으로 고를 수 있다. 이 저장소는 `||` 때문에
    // 0 이 기본값으로 되돌아가는 사고를 이미 겪었다(적대적 재감사 #9).
    expect(validateSettingValue('shift', 'break_time_minutes', 0)).toEqual({ ok: true, value: 0 });
    expect(validateSettingValue('shift', 'shift_change_buffer_minutes', 0)).toEqual({ ok: true, value: 0 });
  });

  it('성능 목표는 1 을 넘을 수 있다 — 화면이 허용하는 범위를 API 가 막지 않는다', () => {
    expect(validateSettingValue('oee', 'target_performance', 1.2).ok).toBe(true);
    expect(validateSettingValue('oee', 'target_oee', 1.2).ok).toBe(false);
  });

  it('선택지 밖의 값을 거부한다', () => {
    expect(validateSettingValue('display', 'theme_mode', 'dark').ok).toBe(true);
    const result = validateSettingValue('display', 'theme_mode', 'neon');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('light, dark');
  });

  it('시각과 색상은 형식을 검사한다', () => {
    expect(validateSettingValue('shift', 'shift_a_start', '08:00').ok).toBe(true);
    expect(validateSettingValue('shift', 'shift_a_start', '25:00').ok).toBe(false);
    expect(validateSettingValue('display', 'theme_primary_color', '#1890ff').ok).toBe(true);
    expect(validateSettingValue('display', 'theme_primary_color', 'blue').ok).toBe(false);
  });

  it('required 인 문자열은 비워 둘 수 없고, 그렇지 않은 문자열은 비울 수 있다', () => {
    expect(validateSettingValue('general', 'company_name', '   ').ok).toBe(false);
    expect(validateSettingValue('notification', 'notification_email', '').ok).toBe(true);
  });

  it('null 과 undefined 를 거부한다', () => {
    expect(validateSettingValue('general', 'company_name', null).ok).toBe(false);
    expect(validateSettingValue('general', 'company_name', undefined).ok).toBe(false);
  });
});
