/**
 * 알림 임계값 해석. **라우트 파일이 아니다** — Next.js 의 route.ts 는 GET/POST 같은 정해진
 * 이름만 export 할 수 있어서, 검증 가능한 순수 함수를 그 안에 둘 수 없다.
 * (같은 이유로 `api/production-records/oeeRules.ts` 도 라우트 밖에 있다.)
 */
export const DEFAULT_BUSINESS_CLOCK = {
  timezone: 'Asia/Ho_Chi_Minh',
  shiftAStart: '08:00',
  shiftBStart: '20:00',
};

/** `system_settings` 에서 읽어온 행 모양. 해석 함수는 이것만 알면 된다. */
export interface SettingRow {
  category: string;
  setting_key: string;
  setting_value: unknown;
}

/**
 * 설정 행 → 시계 + 임계값. **DB 를 모르는 순수 함수라 단위·순서를 직접 검증할 수 있다.**
 *
 * 조회는 실패 여부만 다루면 되지만, 위험한 것은 여기다 — 비율/퍼센트 혼동과 경고·위험 순서.
 * 그래서 이 경계에서 잘라 두고 회귀 검사를 붙인다.
 */
export function resolveAlertConfig(data: SettingRow[]): {
  clock: typeof DEFAULT_BUSINESS_CLOCK;
  thresholds: AlertThresholds;
  thresholdFallbacks: string[];
} {
  const raw = (category: string, key: string): unknown => {
    const setting = data.find(row => row.category === category && row.setting_key === key)
      ?.setting_value as { value?: unknown } | null | undefined;
    return setting?.value;
  };
  const str = (category: string, key: string): string | undefined => {
    const value = raw(category, key);
    return typeof value === 'string' ? value : undefined;
  };
  /** 비율(0..1) 설정을 퍼센트로. 숫자가 아니면 undefined — 0 은 합법적인 값이라 살린다. */
  const ratioAsPercent = (key: string): number | undefined => {
    const value = raw('oee', key);
    return typeof value === 'number' && Number.isFinite(value) ? value * 100 : undefined;
  };
  const minutes = (key: string): number | undefined => {
    const value = raw('oee', key);
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
  };

  const fallbacks: string[] = [];

  /**
   * 경고선은 위험선보다 **높아야** 한다(값이 낮을수록 나쁜 지표 기준).
   *
   * 뒤집히면 `if (critical) else if (warning)` 사슬에서 경고 가지가 영영 실행되지 않는다 —
   * 모든 미달이 '위험'으로 뭉개지고 심각도 구분이 사라진다. 설정 화면은 OEE 세 값의 순서만
   * 검사하고 API·DB 는 순서를 강제하지 않으므로 여기서 막는다. 조용히 클램프하지 않고
   * 그 지표만 기본값으로 물러난 뒤 응답에 남긴다 — 그래야 관리자가 왜 안 바뀌는지 안다.
   */
  const pair = (
    name: keyof AlertThresholds,
    warning: number | undefined,
    critical: number | undefined,
    lowerIsWorse = true,
  ): AlertThresholdPair => {
    const fallback = DEFAULT_ALERT_THRESHOLDS[name];
    if (warning === undefined || critical === undefined) {
      fallbacks.push(`${name}:missing`);
      return fallback;
    }
    const ordered = lowerIsWorse ? critical < warning : critical > warning;
    if (!ordered) {
      console.error(
        `알림 임계값 순서 오류(${name}): 경고=${warning}, 위험=${critical}. 기본값으로 판정한다.`
      );
      fallbacks.push(`${name}:out_of_order`);
      return fallback;
    }
    return { warning, critical };
  };

  const downtimeWarning = minutes('downtime_alert_minutes');

  return {
    clock: {
      timezone: str('general', 'timezone') || DEFAULT_BUSINESS_CLOCK.timezone,
      shiftAStart: str('shift', 'shift_a_start') || DEFAULT_BUSINESS_CLOCK.shiftAStart,
      shiftBStart: str('shift', 'shift_b_start') || DEFAULT_BUSINESS_CLOCK.shiftBStart,
    },
    thresholds: {
      // OEE 만 목표와 별개로 '저하' 임계값이 있어 경고선이 target_oee 가 아니다.
      oee: pair('oee', ratioAsPercent('low_oee_threshold'), ratioAsPercent('critical_oee_threshold')),
      availability: pair('availability',
        ratioAsPercent('target_availability'), ratioAsPercent('critical_availability_threshold')),
      performance: pair('performance',
        ratioAsPercent('target_performance'), ratioAsPercent('critical_performance_threshold')),
      quality: pair('quality',
        ratioAsPercent('target_quality'), ratioAsPercent('critical_quality_threshold')),
      // 다운타임만 방향이 반대다 — 길수록 나쁘므로 위험선이 경고선보다 크다.
      downtime: pair('downtime',
        downtimeWarning,
        downtimeWarning === undefined ? undefined : downtimeWarning * 2,
        false),
    },
    thresholdFallbacks: fallbacks,
  };
}

/**
 * 알림 임계값. **관리자 설정에서 온다** (감사 2026-08-06 HIGH-02/03).
 *
 * 예전에는 이 자리에 리터럴 표가 있었다. 관리자가 설정 화면에서 목표·임계값을 바꾸고 저장에
 * 성공해도 알림 판단은 그대로였고, 그 사실을 알 방법이 없었다.
 *
 * ⚠️ **단위가 다르다.** 설정은 비율(0..1)이고 이 파일의 지표는 이미 퍼센트로 변환돼 있다
 *    (`machine.latest_oee * 100`). 그래서 경계에서 **한 번만** ×100 하고, 아래 판정 코드는
 *    손대지 않는다. 이 저장소는 분/초 혼동으로 사고를 낸 적이 있어 변환 지점을 한 곳에 모은다.
 *
 * 대응 관계:
 *   경고 = "목표 미달"  → target_* (OEE 만 low_oee_threshold — 목표와 저하가 따로 있다)
 *   위험 = "위험 수준"  → critical_*
 *   다운타임은 방향이 반대다(클수록 나쁘다). 경고 = downtime_alert_minutes, 위험 = 그 2배.
 *   2배라는 관계는 예전 하드코딩(경고 60 / 위험 120)에서 그대로 가져왔다.
 */
export interface AlertThresholdPair {
  /** 퍼센트(0..100). 다운타임만 분. */
  critical: number;
  warning: number;
}
export interface AlertThresholds {
  oee: AlertThresholdPair;
  availability: AlertThresholdPair;
  performance: AlertThresholdPair;
  quality: AlertThresholdPair;
  downtime: AlertThresholdPair;
}

/** 설정을 읽지 못했을 때 쓰는 값. 레지스트리 기본값과 같은 숫자를 퍼센트로 표현한 것이다. */
export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  oee: { critical: 40, warning: 60 },
  availability: { critical: 70, warning: 90 },
  performance: { critical: 70, warning: 95 },
  quality: { critical: 90, warning: 99 },
  downtime: { critical: 60, warning: 30 },
};
