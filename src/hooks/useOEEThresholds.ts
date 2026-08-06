'use client';

import { useMemo } from 'react';
import { useSystemSettings } from './useSystemSettings';
import {
  OEE_GRADE_COLORS,
  oeeGradeColor,
  resolveOEEGrade,
  resolveOEEGradingThresholds,
  type OEEGrade,
  type OEEGradeResult,
  type OEEGradingThresholds,
} from '@/lib/oeeGrading';

/**
 * 화면이 등급을 매기는 데 필요한 최소한만 돌려주는 훅.
 *
 * 게이지·운영자·엔지니어·관리자 화면이 **모두 이것 하나만** 쓴다. 화면마다 사다리를
 * 다시 적으면 같은 OEE 가 화면마다 다른 등급으로 보이고, 관리자가 설정을 바꿔도 아무
 * 화면도 따라오지 않는다 — 정확히 그 상태였다.
 *
 * 판정 규칙 자체는 `@/lib/oeeGrading` 에 있다. 여기서는 설정을 읽어 넘기기만 한다.
 */
export function useOEEGrading(): {
  thresholds: OEEGradingThresholds;
  gradeOf: (value: number | null | undefined) => OEEGradeResult;
  colorOf: (value: number | null | undefined) => string;
} {
  const { getSetting } = useSystemSettings();

  const thresholds = useMemo(
    () =>
      resolveOEEGradingThresholds({
        target: getSetting('oee', 'target_oee'),
        low: getSetting('oee', 'low_oee_threshold'),
        critical: getSetting('oee', 'critical_oee_threshold'),
      }),
    [getSetting]
  );

  return useMemo(
    () => ({
      thresholds,
      gradeOf: (value: number | null | undefined) => resolveOEEGrade(value, thresholds),
      colorOf: (value: number | null | undefined) => oeeGradeColor(value, thresholds),
    }),
    [thresholds]
  );
}

/**
 * OEE 임계값 기반 상태 판정 훅
 */
export function useOEEThresholds() {
  const { getOEETargets, getOEEThresholds } = useSystemSettings();
  const { thresholds: grading } = useOEEGrading();

  const targets = getOEETargets();
  const thresholds = getOEEThresholds();

  // OEE 상태 판정 함수들
  const oeeStatus = useMemo(() => ({
    /** 등급 사다리 (판정 규칙은 `@/lib/oeeGrading` 하나뿐이다) */
    grading,

    /**
     * OEE 값에 따른 상태 반환
     */
    getStatus: (oeeValue: number): OEEGrade | null =>
      resolveOEEGrade(oeeValue, grading).grade,

    /**
     * 상태에 따른 색상 반환
     */
    getStatusColor: (status: OEEGrade | null): string =>
      status === null ? '#d9d9d9' : OEE_GRADE_COLORS[status],

    /**
     * OEE 값에 따른 색상 직접 반환
     */
    getOEEColor: (oeeValue: number): string => oeeGradeColor(oeeValue, grading),

    /**
     * 가동률 상태 판정
     */
    getAvailabilityStatus: (availability: number): 'excellent' | 'good' | 'warning' | 'critical' => {
      if (availability >= targets.availability) return 'excellent';
      if (availability >= targets.availability * 0.8) return 'good';
      if (availability >= targets.availability * 0.6) return 'warning';
      return 'critical';
    },

    /**
     * 성능 상태 판정
     */
    getPerformanceStatus: (performance: number): 'excellent' | 'good' | 'warning' | 'critical' => {
      if (performance >= targets.performance) return 'excellent';
      if (performance >= targets.performance * 0.8) return 'good';
      if (performance >= targets.performance * 0.6) return 'warning';
      return 'critical';
    },

    /**
     * 품질 상태 판정
     */
    getQualityStatus: (quality: number): 'excellent' | 'good' | 'warning' | 'critical' => {
      if (quality >= targets.quality) return 'excellent';
      if (quality >= targets.quality * 0.95) return 'good';
      if (quality >= targets.quality * 0.9) return 'warning';
      return 'critical';
    },

    /**
     * 다운타임 알림 필요 여부 판정
     */
    shouldAlertDowntime: (downtimeMinutes: number): boolean => {
      return downtimeMinutes >= thresholds.downtimeAlert;
    },

    /**
     * 목표 달성률 계산
     */
    getTargetAchievement: (actualValue: number, targetValue: number): number => {
      if (targetValue === 0) return 0;
      return (actualValue / targetValue) * 100;
    },

    /**
     * OEE 등급 반환 (A, B, C, D)
     *
     * 사다리를 다시 적지 않는다 — 같은 판정에 이름만 다르게 붙인다.
     * 등급을 매길 수 없는 값(NaN 등)은 D 가 아니라 `null` 이다.
     */
    getOEEGrade: (oeeValue: number): 'A' | 'B' | 'C' | 'D' | null => {
      const grade = resolveOEEGrade(oeeValue, grading).grade;
      if (grade === null) return null;
      return ({ excellent: 'A', good: 'B', warning: 'C', critical: 'D' } as const)[grade];
    },

    /**
     * 개선 필요 영역 식별
     */
    getImprovementAreas: (availability: number, performance: number, quality: number): string[] => {
      const areas: string[] = [];
      
      if (availability < targets.availability) {
        areas.push('availability');
      }
      if (performance < targets.performance) {
        areas.push('performance');
      }
      if (quality < targets.quality) {
        areas.push('quality');
      }
      
      return areas;
    },

    /**
     * OEE 손실 분석
     */
    analyzeLosses: (availability: number, performance: number, quality: number) => {
      const oee = availability * performance * quality;
      const targetOEE = targets.oee;
      
      const availabilityLoss = (1 - availability) * 100;
      const performanceLoss = availability * (1 - performance) * 100;
      const qualityLoss = availability * performance * (1 - quality) * 100;
      const totalLoss = (1 - oee) * 100;
      
      return {
        oee,
        targetOEE,
        totalLoss,
        availabilityLoss,
        performanceLoss,
        qualityLoss,
        gapToTarget: Math.max(0, (targetOEE - oee) * 100)
      };
    }
  }), [targets, thresholds, grading]);

  return {
    targets,
    thresholds,
    ...oeeStatus
  };
}