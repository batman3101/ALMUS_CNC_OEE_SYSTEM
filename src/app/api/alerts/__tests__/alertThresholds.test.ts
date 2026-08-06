/**
 * 알림 임계값 해석 회귀 검사. (감사 2026-08-06 HIGH-02/03)
 *
 * 예전에는 `/api/alerts` 안에 10개짜리 리터럴 표가 있었다. 관리자가 목표·임계값을 바꾸고
 * 저장에 성공해도 알림 판단은 그대로였고, 밖에서 그 사실을 확인할 방법이 없었다.
 *
 * 이 파일이 지키는 것은 두 가지다. 둘 다 조용히 틀리는 종류라 눈으로는 안 잡힌다.
 *
 *  ① **단위** — 설정은 비율(0..1), 알림 판정부는 퍼센트(0..100). 변환을 빠뜨리면 "OEE 0.85%
 *     미만이면 경고" 가 되어 알림이 **영원히 안 뜬다**. 화면에는 아무 오류도 없다.
 *     이 저장소는 분/초 혼동으로 이미 사고를 냈다.
 *  ② **순서** — 판정은 `if (위험) else if (경고)` 사슬이다. 위험선이 경고선보다 높으면
 *     경고 가지가 영영 실행되지 않고 모든 미달이 '위험' 으로 뭉개진다. 알림은 계속 오므로
 *     고장으로 보이지도 않는다.
 */
import {
  resolveAlertConfig,
  DEFAULT_ALERT_THRESHOLDS,
  DEFAULT_BUSINESS_CLOCK,
  type SettingRow,
} from '../alertThresholds';

/** 라이브(2026-08-06)와 같은 모양의 설정 행. */
const row = (category: string, setting_key: string, value: unknown): SettingRow => ({
  category,
  setting_key,
  setting_value: { value },
});

const LIVE_ROWS: SettingRow[] = [
  row('general', 'timezone', 'Asia/Ho_Chi_Minh'),
  row('shift', 'shift_a_start', '08:00'),
  row('shift', 'shift_b_start', '20:00'),
  row('oee', 'low_oee_threshold', 0.65),
  row('oee', 'critical_oee_threshold', 0.6),
  row('oee', 'target_availability', 0.9),
  row('oee', 'target_performance', 0.95),
  row('oee', 'target_quality', 0.99),
  row('oee', 'critical_availability_threshold', 0.7),
  row('oee', 'critical_performance_threshold', 0.7),
  row('oee', 'critical_quality_threshold', 0.9),
  row('oee', 'downtime_alert_minutes', 30),
];

describe('알림 임계값 해석', () => {
  it('비율 설정을 퍼센트로 바꾼다 — 판정부의 단위와 맞춘다', () => {
    const { thresholds, thresholdFallbacks } = resolveAlertConfig(LIVE_ROWS);

    // 0.65 가 65 로 오지 않으면 "OEE 0.65% 미만" 이 되어 경고가 영원히 안 뜬다.
    expect(thresholds.oee).toEqual({ warning: 65, critical: 60 });
    expect(thresholds.availability).toEqual({ warning: 90, critical: 70 });
    expect(thresholds.performance).toEqual({ warning: 95, critical: 70 });
    expect(thresholds.quality).toEqual({ warning: 99, critical: 90 });
    expect(thresholdFallbacks).toEqual([]);
  });

  it('다운타임만 분 단위이고 방향이 반대다 — 위험선이 경고선의 2배', () => {
    const { thresholds } = resolveAlertConfig(LIVE_ROWS);
    // 다른 지표는 낮을수록 나쁘지만 다운타임은 길수록 나쁘다.
    expect(thresholds.downtime).toEqual({ warning: 30, critical: 60 });
    expect(thresholds.downtime.critical).toBeGreaterThan(thresholds.downtime.warning);
  });

  it('설정을 바꾸면 임계값이 실제로 따라간다', () => {
    // 이 검사가 이 파일의 존재 이유다. 리터럴 표로 되돌리면 여기가 먼저 깨진다.
    const changed = LIVE_ROWS.map(r =>
      r.setting_key === 'target_quality' ? row('oee', 'target_quality', 0.95) : r
    );
    expect(resolveAlertConfig(changed).thresholds.quality.warning).toBe(95);
  });

  it('경고보다 높은 위험선은 받아들이지 않고 그 지표만 기본값으로 물러난다', () => {
    // 품질 위험 0.995 > 목표 0.99. 그대로 두면 99.5% 미만이 전부 '위험' 이 되고
    // 경고 가지는 죽는다.
    const inverted = LIVE_ROWS.map(r =>
      r.setting_key === 'critical_quality_threshold'
        ? row('oee', 'critical_quality_threshold', 0.995)
        : r
    );
    const { thresholds, thresholdFallbacks } = resolveAlertConfig(inverted);

    expect(thresholds.quality).toEqual(DEFAULT_ALERT_THRESHOLDS.quality);
    expect(thresholdFallbacks).toContain('quality:out_of_order');
    // 나머지 지표는 멀쩡한 설정을 계속 쓴다 — 한 값이 틀렸다고 전부 버리지 않는다.
    expect(thresholds.oee).toEqual({ warning: 65, critical: 60 });
  });

  it('빠진 설정은 그 지표만 기본값으로 물러나고 사실을 남긴다', () => {
    const missing = LIVE_ROWS.filter(r => r.setting_key !== 'critical_performance_threshold');
    const { thresholds, thresholdFallbacks } = resolveAlertConfig(missing);

    expect(thresholds.performance).toEqual(DEFAULT_ALERT_THRESHOLDS.performance);
    expect(thresholdFallbacks).toContain('performance:missing');
    expect(thresholds.quality).toEqual({ warning: 99, critical: 90 });
  });

  it('폴백은 응답으로 나가야 한다 — 조용히 기본값으로 돌면 원인을 밖에서 알 수 없다', () => {
    const { thresholdFallbacks } = resolveAlertConfig([]);
    // 전부 비어 있으면 다섯 지표가 모두 물러난다. 개수가 아니라 "말해 준다" 가 요점이다.
    expect(thresholdFallbacks.length).toBeGreaterThan(0);
    expect(thresholdFallbacks.every(entry => entry.endsWith(':missing'))).toBe(true);
  });

  it('0 은 합법적인 값이다 — falsy 라고 버리지 않는다', () => {
    // "위험 등급을 쓰지 않겠다" 는 0 으로 표현된다. `||` 로 읽으면 이 의도가 기본값에
    // 덮인다 — 설정 화면 전반에서 같은 결함을 고쳤고 여기도 같은 규칙이다.
    const zeroed = LIVE_ROWS.map(r =>
      r.setting_key === 'critical_oee_threshold' ? row('oee', 'critical_oee_threshold', 0) : r
    );
    const { thresholds, thresholdFallbacks } = resolveAlertConfig(zeroed);
    expect(thresholds.oee).toEqual({ warning: 65, critical: 0 });
    expect(thresholdFallbacks).toEqual([]);
  });

  it('숫자가 아닌 값은 숫자인 척하지 않는다', () => {
    const bogus = LIVE_ROWS.map(r =>
      r.setting_key === 'target_availability' ? row('oee', 'target_availability', 'high') : r
    );
    const { thresholds, thresholdFallbacks } = resolveAlertConfig(bogus);
    expect(thresholds.availability).toEqual(DEFAULT_ALERT_THRESHOLDS.availability);
    expect(thresholdFallbacks).toContain('availability:missing');
  });

  it('시계 설정도 같은 조회에서 함께 온다', () => {
    const { clock } = resolveAlertConfig(LIVE_ROWS);
    expect(clock).toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      shiftAStart: '08:00',
      shiftBStart: '20:00',
    });
    // 빠지면 기존 기본값 — 이 동작은 이번 변경 전과 같아야 한다.
    expect(resolveAlertConfig([]).clock).toEqual(DEFAULT_BUSINESS_CLOCK);
  });

  it('기본값은 레지스트리 기본값과 같은 숫자다 (퍼센트로 표현한 것뿐)', () => {
    // 두 곳이 갈라지면 "마이그레이션 적용 전" 과 "적용 후" 의 알림 동작이 달라진다.
    expect(DEFAULT_ALERT_THRESHOLDS.availability.critical).toBe(0.7 * 100);
    expect(DEFAULT_ALERT_THRESHOLDS.performance.critical).toBe(0.7 * 100);
    expect(DEFAULT_ALERT_THRESHOLDS.quality.critical).toBe(0.9 * 100);
    expect(DEFAULT_ALERT_THRESHOLDS.downtime.warning).toBe(30);
  });
});
