import { calculateRealtimeProgress } from '../realtimeProgress';

// 스펙 §6.1 의 실측 기준값. CNC-001: tact 72초/개.
// 가동 720분 − 휴식 110분 = 계획 610분. CAPA = 610 / (72/60) = 508개.
const base = {
  shift: 'A' as const,
  shiftStart: new Date('2026-07-17T08:00:00+07:00'),
  operatingMinutes: 720,
  tactTimeSeconds: 72,
  downtimeMinutes: 0,
  shiftOutputQty: 60,
};

describe('calculateRealtimeProgress', () => {
  it('스펙 §6.1 예시를 그대로 재현한다 (10:00, 60개, 비가동 0)', () => {
    const r = calculateRealtimeProgress({ ...base, now: new Date('2026-07-17T10:00:00+07:00') });

    expect(r.elapsedPlannedMinutes).toBe(110);   // 120 경과 − 10 휴식
    expect(r.actualRuntimeMinutes).toBe(110);
    expect(r.idealRuntimeMinutes).toBeCloseTo(72, 5);
    expect(r.availability).toBeCloseTo(1, 5);
    expect(r.performance).toBeCloseTo(72 / 110, 5);
    expect(r.availabilityTimesPerformance).toBeCloseTo(72 / 110, 5);
    expect(r.plannedRuntimeMinutes).toBe(610);
    expect(r.capaQty).toBe(508);
    expect(r.progressQty).toBe(60);
    expect(r.progressRatio).toBeCloseTo(60 / 508, 5);
    expect(r.elapsedRatio).toBeCloseTo(110 / 610, 5);
  });

  // 품질은 검사 전이라 모른다. 0% 로 단정하면 멀쩡한 설비가 죽은 것처럼 보인다
  // (2026-07-17 PR #18 에서 고친 버그를 새 기능으로 재생산하는 셈).
  it('OEE 와 품질을 계산하지 않는다 (필드 자체가 없다)', () => {
    const r = calculateRealtimeProgress({ ...base, now: new Date('2026-07-17T10:00:00+07:00') });
    expect(r).not.toHaveProperty('oee');
    expect(r).not.toHaveProperty('quality');
  });

  it('보고가 없으면 성능·진척은 null 이고 가동률은 계산된다', () => {
    const r = calculateRealtimeProgress({
      ...base,
      shiftOutputQty: null,
      now: new Date('2026-07-17T10:00:00+07:00'),
    });

    expect(r.availability).toBeCloseTo(1, 5);
    expect(r.performance).toBeNull();
    expect(r.availabilityTimesPerformance).toBeNull();
    expect(r.progressQty).toBeNull();
    expect(r.progressRatio).toBeNull();
  });

  it('비가동이 있으면 가동률이 내려간다', () => {
    const r = calculateRealtimeProgress({
      ...base,
      downtimeMinutes: 11,
      now: new Date('2026-07-17T10:00:00+07:00'),
    });

    expect(r.actualRuntimeMinutes).toBe(99);          // 110 − 11
    expect(r.availability).toBeCloseTo(99 / 110, 5);
  });

  // 가동×성능이 정말 "곱"인지 못 박는다. §6.1 은 가동률이 1 이라 1×P === P 이므로
  // 곱을 통째로 지우고 P 만 돌려줘도 통과한다 (실제로 살아남는 것을 확인했다).
  // 가동률 ≠ 1 인 경우가 있어야 곱이 두 인자 어느 쪽과도 구별된다.
  it('가동×성능은 두 인자의 곱이다 (가동률 ≠ 1)', () => {
    const r = calculateRealtimeProgress({
      ...base,
      downtimeMinutes: 11,
      now: new Date('2026-07-17T10:00:00+07:00'),
    });

    expect(r.availability).toBeCloseTo(99 / 110, 5);
    expect(r.performance).toBeCloseTo(72 / 99, 5);
    expect(r.availabilityTimesPerformance).toBeCloseTo((99 / 110) * (72 / 99), 5);

    // 곱은 어느 한쪽 인자와도 다르다 — 한쪽만 돌려주면 여기서 죽는다.
    expect(r.availabilityTimesPerformance).not.toBeCloseTo(99 / 110, 5);
    expect(r.availabilityTimesPerformance).not.toBeCloseTo(72 / 99, 5);
  });

  // 완전히 멈춰 있던 설비의 가동률 0 은 진짜 0 이다 — "계산 불가(null)"와 구분해야 한다.
  // 성능은 다르다: 0분 돌린 설비가 "얼마나 효율적으로 돌았나"는 대답할 수 없다.
  // 여기서 0% 를 띄우면 "돌긴 돌았는데 형편없었다"로 읽힌다 — 안 돌았다.
  // (기존 OEECalculator.calculatePerformance 는 actualRuntime<=0 에 0 을 주지만, 그쪽은
  //  A×P×Q 로 곱해질 뿐 사람에게 따로 보여주지 않으므로 무해하다. 이 모듈은 P 를 화면에
  //  직접 띄우므로 같은 0 이 거짓말이 된다.)
  it('경과 내내 비가동이면 가동률은 0(측정값), 성능은 null(대답 불가)', () => {
    const r = calculateRealtimeProgress({
      ...base,
      downtimeMinutes: 110,
      shiftOutputQty: 0,   // 0분 돌린 설비가 60개를 만들 수는 없다
      now: new Date('2026-07-17T10:00:00+07:00'),
    });

    expect(r.actualRuntimeMinutes).toBe(0);
    expect(r.availability).toBe(0);                     // 110분 중 0분 돌았다 — 측정된 사실
    expect(r.performance).toBeNull();                   // 안 돌았으니 효율을 말할 수 없다
    expect(r.availabilityTimesPerformance).toBeNull();
  });

  it('교대 시작 직후 경과 계획시간이 0 이면 비율을 만들지 않는다', () => {
    const r = calculateRealtimeProgress({ ...base, now: new Date('2026-07-17T08:00:00+07:00') });

    expect(r.elapsedPlannedMinutes).toBe(0);
    expect(r.availability).toBeNull();
    expect(r.performance).toBeNull();
    expect(r.availabilityTimesPerformance).toBeNull();
  });

  it('교대 종료 시 경과 계획시간이 610분이 된다', () => {
    const r = calculateRealtimeProgress({ ...base, now: new Date('2026-07-17T20:00:00+07:00') });
    expect(r.elapsedPlannedMinutes).toBe(610);
  });

  // 교대가 끝난 뒤에도 화면이 열려 있을 수 있다. 캡이 없으면 경과 계획시간이 610 을 넘어
  // 가동률 분모가 계속 커지고, 다 돌린 교대가 시간이 갈수록 나빠 보인다.
  it('교대 종료 후에도 경과 계획시간이 610 을 넘지 않는다', () => {
    const r = calculateRealtimeProgress({ ...base, now: new Date('2026-07-17T23:00:00+07:00') });

    expect(r.elapsedPlannedMinutes).toBe(610);
    expect(r.elapsedRatio).toBeCloseTo(1, 5);
  });

  // 기존 OEECalculator 와 같은 규칙: 비율은 0..1 로 자른다.
  it('성능률이 1 을 넘지 않는다', () => {
    const r = calculateRealtimeProgress({
      ...base,
      shiftOutputQty: 500,
      now: new Date('2026-07-17T10:00:00+07:00'),
    });
    expect(r.performance).toBe(1);
  });

  // CAPA 는 "실제로 만들 수 있는 최대 개수"다. 610/1.2 = 508.33 개를 만들 수는 없으므로
  // 내림이 맞다 — round/ceil 은 도달 불가능한 목표를 내걸어 작업자가 못 채울 숫자를 쫓게 한다.
  // tact 72 초에서는 508.33 이라 floor 와 round 가 같아 구분되지 않는다. 갈리는 값으로 고정한다.
  it('CAPA 는 반올림이 아니라 내림이다 (도달 가능한 수만 목표로 내건다)', () => {
    // 610 / (70/60) = 522.86 → floor 522, round 523
    const tactTimeSeconds = 70;
    const exactCapa = 610 / (tactTimeSeconds / 60);   // 522.857…

    // 이 테스트는 floor 와 round 가 갈리는 tact 에서만 의미가 있다. 픽스처를 현실값 72 로
    // "정리"하면 508 === 508 이 되어 통과하면서 검증력을 잃는다. 그 순간 여기서 죽는다.
    expect(Math.floor(exactCapa)).not.toBe(Math.round(exactCapa));

    const r = calculateRealtimeProgress({
      ...base,
      tactTimeSeconds,
      now: new Date('2026-07-17T10:00:00+07:00'),
    });
    expect(r.capaQty).toBe(522);
  });

  // tact 는 개당(1 piece) 이며 cavity 로 나누지 않는다 (CLAUDE.md 의 도메인 규칙).
  it('tact 가 0 이하면 성능을 계산하지 않는다', () => {
    const r = calculateRealtimeProgress({
      ...base,
      tactTimeSeconds: 0,
      now: new Date('2026-07-17T10:00:00+07:00'),
    });
    expect(r.performance).toBeNull();
    expect(r.capaQty).toBeNull();
  });

  // 720분 교대를 전제로 한 시간대이므로, 더 짧은 교대는 애초에 계산할 수 없다.
  // 480분이면 경과 기준 400 vs 총량 기준 370 으로 어긋나 진척 바가 108% 가 된다.
  it.each([480, 300, 120, 0])('교대가 %p 분이면 휴식 시간대를 담지 못하므로 거부한다', (operatingMinutes) => {
    expect(() => calculateRealtimeProgress({
      ...base, operatingMinutes, now: new Date('2026-07-17T10:00:00+07:00'),
    })).toThrow();
  });

  it('시간대가 딱 들어가는 600분 교대는 받는다', () => {
    const r = calculateRealtimeProgress({
      ...base, operatingMinutes: 600, now: new Date('2026-07-17T18:00:00+07:00'),
    });
    // 경과 600 − 휴식 110 = 490 = 600 − 110. 두 식이 일치하는 경계.
    expect(r.elapsedPlannedMinutes).toBe(490);
    expect(r.plannedRuntimeMinutes).toBe(490);
    expect(r.elapsedRatio).toBeCloseTo(1, 5);
  });

  // Math.max(0, NaN) 은 0 이 아니라 NaN 이다. 비유한값은 상류의 버그이므로 거부한다.
  it('downtimeMinutes 가 유효한 수가 아니면 거부한다', () => {
    expect(() => calculateRealtimeProgress({
      ...base, downtimeMinutes: Number.NaN, now: new Date('2026-07-17T10:00:00+07:00'),
    })).toThrow();
  });

  it('shiftOutputQty 가 NaN 이면 거부한다 (null 은 정상 — 아직 보고 없음)', () => {
    expect(() => calculateRealtimeProgress({
      ...base, shiftOutputQty: Number.NaN, now: new Date('2026-07-17T10:00:00+07:00'),
    })).toThrow();

    // null 은 던지지 않는다 — 보고가 없는 것은 오류가 아니다.
    expect(() => calculateRealtimeProgress({
      ...base, shiftOutputQty: null, now: new Date('2026-07-17T10:00:00+07:00'),
    })).not.toThrow();
  });

  // B 교대는 자정을 넘는다. 이 프로젝트에서 자정 경계는 반복된 함정이다.
  it('B 교대: 자정을 넘긴 02:00 에도 경과 계획시간이 맞다', () => {
    const r = calculateRealtimeProgress({
      ...base,
      shift: 'B',
      shiftStart: new Date('2026-07-17T20:00:00+07:00'),
      now: new Date('2026-07-18T02:00:00+07:00'),
    });

    // 경과 360분 − 지나간 휴식 70분(21:50~22:00 의 10 + 23:20~00:20 의 60) = 290분
    expect(r.elapsedPlannedMinutes).toBe(290);
  });
});
