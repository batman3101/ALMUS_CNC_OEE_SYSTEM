'use client';

import { useMemo } from 'react';
import { useSystemSettings } from './useSystemSettings';

/**
 * OEE 임계값 기반 상태 판정 훅
 */
export function useOEEThresholds() {
  const { getOEETargets, getOEEThresholds } = useSystemSettings();

  const targets = getOEETargets();
  const thresholds = getOEEThresholds();

  // OEE 상태 판정 함수들
  const oeeStatus = useMemo(() => ({
    /**
     * OEE 값에 따른 상태 반환
     */
    getStatus: (oeeValue: number): 'excellent' | 'good' | 'warning' | 'critical' => {
      if (oeeValue >= targets.oee) return 'excellent';
      if (oeeValue >= thresholds.low) return 'good';
      if (oeeValue >= thresholds.critical) return 'warning';
      return 'critical';
    },

    /**
     * 상태에 따른 색상 반환
     */
    getStatusColor: (status: 'excellent' | 'good' | 'warning' | 'critical'): string => {
      switch (status) {
        case 'excellent': return '#52c41a'; // 녹색
        case 'good': return '#1890ff';      // 파란색
        case 'warning': return '#faad14';   // 주황색
        case 'critical': return '#ff4d4f';  // 빨간색
        default: return '#d9d9d9';          // 회색
      }
    },

    /**
     * OEE 값에 따른 색상 직접 반환
     */
    getOEEColor: (oeeValue: number): string => {
      const status = oeeStatus.getStatus(oeeValue);
      return oeeStatus.getStatusColor(status);
    },

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
     */
    getOEEGrade: (oeeValue: number): 'A' | 'B' | 'C' | 'D' => {
      if (oeeValue >= targets.oee) return 'A';
      if (oeeValue >= thresholds.low) return 'B';
      if (oeeValue >= thresholds.critical) return 'C';
      return 'D';
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
  }), [targets, thresholds]);

  return {
    targets,
    thresholds,
    ...oeeStatus
  };
}