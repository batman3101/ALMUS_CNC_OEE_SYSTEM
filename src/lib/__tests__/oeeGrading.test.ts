import {
  DEFAULT_OEE_GRADING_THRESHOLDS,
  OEE_GRADE_COLORS,
  OEE_GRADE_LADDER,
  OEE_NO_DATA_COLOR,
  oeeGradeColor,
  resolveOEEGrade,
  resolveOEEGradingThresholds,
} from '../oeeGrading';

/**
 * 등급 사다리의 단위 검사.
 *
 * 화면 배선이 실제로 이 규칙을 쓰는지는 여기서 알 수 없다 — 그건
 * `src/components/__tests__/oeeGradingConsistency.test.tsx` 가 네 화면을 실제로 그려서 본다.
 * 이 파일은 규칙 자체만 못 박는다.
 */

const LIVE = { target: 0.85, low: 0.65, critical: 0.6 }; // 2026-08-06 운영 설정값

describe('resolveOEEGradingThresholds', () => {
  it('저장값이 온전하면 그대로 쓴다', () => {
    expect(resolveOEEGradingThresholds(LIVE)).toEqual({
      target: 0.85,
      low: 0.65,
      critical: 0.6,
      usedDefaults: false,
      repaired: false,
    });
  });

  it.each([
    ['입력 자체가 없음', undefined],
    ['null', null],
    ['빈 객체', {}],
    ['전부 null (설정 미저장)', { target: null, low: null, critical: null }],
  ])('%s 이면 기본값으로 물러난다', (_label, input) => {
    const resolved = resolveOEEGradingThresholds(input);

    expect(resolved.target).toBe(DEFAULT_OEE_GRADING_THRESHOLDS.target);
    expect(resolved.low).toBe(DEFAULT_OEE_GRADING_THRESHOLDS.low);
    expect(resolved.critical).toBe(DEFAULT_OEE_GRADING_THRESHOLDS.critical);
    expect(resolved.usedDefaults).toBe(true);
  });

  it('일부만 비어 있으면 그 항목만 기본값으로 채운다', () => {
    const resolved = resolveOEEGradingThresholds({ target: 0.9, low: null, critical: 0.5 });

    expect(resolved.target).toBe(0.9);
    expect(resolved.low).toBe(DEFAULT_OEE_GRADING_THRESHOLDS.low);
    expect(resolved.critical).toBe(0.5);
    expect(resolved.usedDefaults).toBe(true);
  });

  // 비율이 아닌 값. 85(퍼센트를 그대로 저장) 가 통과하면 사다리 전체가 무너진다.
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['음수', -0.1],
    ['1 초과(퍼센트 오입력)', 85],
  ])('%s 는 비율이 아니므로 기본값으로 대체한다', (_label, bad) => {
    const resolved = resolveOEEGradingThresholds({ target: bad, low: 0.65, critical: 0.6 });

    expect(resolved.target).toBe(DEFAULT_OEE_GRADING_THRESHOLDS.target);
    expect(resolved.usedDefaults).toBe(true);
  });

  it('0 과 1 은 유효한 비율이다 (경계는 배제하지 않는다)', () => {
    const resolved = resolveOEEGradingThresholds({ target: 1, low: 0, critical: 0 });

    expect(resolved).toMatchObject({ target: 1, low: 0, critical: 0, usedDefaults: false });
  });

  // 설정 화면은 critical < low < target 을 검증하지만 API·DB 는 강제하지 않는다.
  describe('순서가 깨진 설정', () => {
    it('low 가 target 보다 크면 target 으로 눌러 담고 repaired 로 알린다', () => {
      const resolved = resolveOEEGradingThresholds({ target: 0.85, low: 0.9, critical: 0.6 });

      expect(resolved).toEqual({
        target: 0.85,
        low: 0.85,
        critical: 0.6,
        usedDefaults: false,
        repaired: true,
      });
    });

    it('critical 이 low 보다 크면 low 로 눌러 담는다', () => {
      const resolved = resolveOEEGradingThresholds({ target: 0.85, low: 0.65, critical: 0.8 });

      expect(resolved).toMatchObject({ target: 0.85, low: 0.65, critical: 0.65, repaired: true });
    });

    it('완전히 뒤집힌 설정도 단조 사다리로 만든다', () => {
      const resolved = resolveOEEGradingThresholds({ target: 0.3, low: 0.6, critical: 0.9 });

      expect(resolved).toMatchObject({ target: 0.3, low: 0.3, critical: 0.3, repaired: true });
    });

    // 보정하지 않으면 판정 순서가 정책을 대신 정한다: 0.87 은 low(0.9) 미만인데도
    // `>= target` 이 먼저 걸려 excellent 가 된다.
    it('보정 덕분에 목표 미달 구간이 excellent 로 새지 않는다', () => {
      const resolved = resolveOEEGradingThresholds({ target: 0.85, low: 0.9, critical: 0.6 });

      expect(resolveOEEGrade(0.87, resolved).grade).toBe('excellent'); // 목표는 넘었다
      expect(resolveOEEGrade(0.84, resolved).grade).toBe('warning');   // good 칸은 비었다
    });
  });
});

describe('resolveOEEGrade', () => {
  const thresholds = resolveOEEGradingThresholds(LIVE);

  it.each([
    ['목표 정확히', 0.85, 'excellent'],
    ['목표 바로 아래', 0.8499, 'good'],
    ['저조 임계 정확히', 0.65, 'good'],
    ['저조 임계 바로 아래', 0.6499, 'warning'],
    ['심각 임계 정확히', 0.6, 'warning'],
    ['심각 임계 바로 아래', 0.5999, 'critical'],
    ['0', 0, 'critical'],
    ['1', 1, 'excellent'],
  ])('%s (%p) → %s', (_label, value, expected) => {
    expect(resolveOEEGrade(value as number, thresholds).grade).toBe(expected);
  });

  it('등급마다 정해진 색을 함께 돌려준다', () => {
    expect(resolveOEEGrade(0.9, thresholds).color).toBe(OEE_GRADE_COLORS.excellent);
    expect(resolveOEEGrade(0.7, thresholds).color).toBe(OEE_GRADE_COLORS.good);
    expect(resolveOEEGrade(0.62, thresholds).color).toBe(OEE_GRADE_COLORS.warning);
    expect(resolveOEEGrade(0.1, thresholds).color).toBe(OEE_GRADE_COLORS.critical);
  });

  it('네 색이 서로 달라야 등급이 구분된다', () => {
    const colors = OEE_GRADE_LADDER.map(grade => OEE_GRADE_COLORS[grade]);
    expect(new Set(colors).size).toBe(OEE_GRADE_LADDER.length);
    expect(colors).not.toContain(OEE_NO_DATA_COLOR);
  });

  // 이 저장소에서 반복된 사고: "계산 불가"를 0% 로 단정하기.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('%s 은 등급을 매기지 않는다 (critical 이 아니다)', (_label, value) => {
    const result = resolveOEEGrade(value as number | null | undefined, thresholds);

    expect(result.graded).toBe(false);
    expect(result.grade).toBeNull();
    expect(result.color).toBe(OEE_NO_DATA_COLOR);
  });

  it('설정을 바꾸면 같은 값의 등급이 따라 바뀐다', () => {
    const strict = resolveOEEGradingThresholds({ target: 0.95, low: 0.9, critical: 0.85 });

    expect(resolveOEEGrade(0.86, thresholds).grade).toBe('excellent');
    expect(resolveOEEGrade(0.86, strict).grade).toBe('warning');
  });

  it('oeeGradeColor 는 resolveOEEGrade 의 색과 같다', () => {
    for (const value of [null, 0, 0.6, 0.65, 0.85, 1]) {
      expect(oeeGradeColor(value, thresholds)).toBe(resolveOEEGrade(value, thresholds).color);
    }
  });
});
