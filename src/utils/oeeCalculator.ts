import { OEEMetrics, ProductionRecord, MachineLog, ErrorCodes } from '@/types';

/**
 * OEE 계산을 위한 유틸리티 클래스
 * OEE = 가동률(Availability) × 성능(Performance) × 품질(Quality)
 */
export class OEECalculator {
  /**
   * 가동률 계산
   * 가동률 = 실제 가동시간 / 계획 가동시간
   * @param actualRuntime 실제 가동시간 (분)
   * @param plannedRuntime 계획 가동시간 (분)
   * @returns 가동률 (0-1 사이의 값)
   */
  static calculateAvailability(actualRuntime: number, plannedRuntime: number): number {
    if (plannedRuntime <= 0) {
      throw new Error(`${ErrorCodes.OEE_CALCULATION_ERROR}: 계획 가동시간은 0보다 커야 합니다.`);
    }
    
    const availability = Math.min(actualRuntime / plannedRuntime, 1);
    return Math.max(0, availability);
  }

  /**
   * 성능 계산
   * 성능 = 이론 생산시간 / 실제 가동시간
   * @param idealRuntime 이론 생산시간 (분)
   * @param actualRuntime 실제 가동시간 (분)
   * @returns 성능 (0-1 사이의 값)
   */
  static calculatePerformance(idealRuntime: number, actualRuntime: number): number {
    if (actualRuntime <= 0) {
      return 0;
    }
    
    const performance = Math.min(idealRuntime / actualRuntime, 1);
    return Math.max(0, performance);
  }

  /**
   * 품질 계산
   * 품질 = 양품 수량 / 총 생산 수량
   * @param outputQty 총 생산 수량
   * @param defectQty 불량 수량
   * @returns 품질 (0-1 사이의 값)
   */
  static calculateQuality(outputQty: number, defectQty: number): number {
    if (outputQty <= 0) {
      return 0;
    }
    
    if (defectQty < 0) {
      throw new Error(`${ErrorCodes.OEE_CALCULATION_ERROR}: 불량 수량은 음수일 수 없습니다.`);
    }
    
    const goodQty = outputQty - defectQty;
    const quality = Math.max(0, goodQty) / outputQty;
    return Math.min(1, quality);
  }

  /**
   * OEE 계산
   * OEE = 가동률 × 성능 × 품질
   * @param availability 가동률
   * @param performance 성능
   * @param quality 품질
   * @returns OEE (0-1 사이의 값)
   */
  static calculateOEE(availability: number, performance: number, quality: number): number {
    // 정확한 계산을 위해 각 값을 소수점 4자리까지 계산 후 최종 결과는 소수점 3자리로 반올림
    const oee = availability * performance * quality;
    return Math.round(oee * 1000) / 1000;
  }

  /**
   * 생산 실적 데이터로부터 OEE 지표 계산
   * @param productionRecord 생산 실적 데이터
   * @returns OEE 지표
   */
  static calculateOEEFromRecord(productionRecord: ProductionRecord): OEEMetrics {
    const {
      planned_runtime = 0,
      actual_runtime = 0,
      ideal_runtime = 0,
      output_qty,
      defect_qty
    } = productionRecord;

    const availability = this.calculateAvailability(actual_runtime, planned_runtime);
    const performance = this.calculatePerformance(ideal_runtime, actual_runtime);
    const quality = this.calculateQuality(output_qty, defect_qty);
    const oee = this.calculateOEE(availability, performance, quality);

    return {
      availability,
      performance,
      quality,
      oee,
      actual_runtime,
      planned_runtime,
      ideal_runtime,
      output_qty,
      defect_qty
    };
  }

  /**
   * 설비 로그 데이터로부터 실제 가동시간 계산
   * @param machineLogs 설비 로그 배열
   * @param startTime 계산 시작 시간
   * @param endTime 계산 종료 시간
   * @returns 실제 가동시간 (분)
   */
  static calculateActualRuntimeFromLogs(
    machineLogs: MachineLog[],
    startTime: Date,
    endTime: Date
  ): number {
    let totalRuntime = 0;

    const filteredLogs = machineLogs.filter(log => {
      const logStart = new Date(log.start_time);
      const logEnd = log.end_time ? new Date(log.end_time) : endTime;
      
      // 로그가 계산 기간과 겹치는지 확인
      return logStart < endTime && logEnd > startTime;
    });

    for (const log of filteredLogs) {
      if (log.state === 'NORMAL_OPERATION') {
        const logStart = new Date(log.start_time);
        const logEnd = log.end_time ? new Date(log.end_time) : endTime;
        
        // 계산 기간 내의 실제 가동시간만 계산
        const effectiveStart = logStart > startTime ? logStart : startTime;
        const effectiveEnd = logEnd < endTime ? logEnd : endTime;
        
        if (effectiveEnd > effectiveStart) {
          const duration = (effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60); // 분 단위
          totalRuntime += duration;
        }
      }
    }

    return totalRuntime;
  }

  /**
   * 이론 생산시간 계산
   * @param outputQty 생산 수량
   * @param tactTime 택트 타임 (초)
   * @returns 이론 생산시간 (분)
   */
  static calculateIdealRuntime(outputQty: number, tactTime: number): number {
    if (tactTime <= 0) {
      throw new Error(`${ErrorCodes.OEE_CALCULATION_ERROR}: 택트 타임은 0보다 커야 합니다.`);
    }
    
    return (outputQty * tactTime) / 60; // 분 단위로 변환
  }

  /**
   * 계획 가동시간 계산 (교대 시간 기준)
   * @param shiftHours 교대 시간 (시간)
   * @param plannedBreakMinutes 계획된 휴식 시간 (분)
   * @returns 계획 가동시간 (분)
   */
  static calculatePlannedRuntime(shiftHours: number = 12, plannedBreakMinutes: number = 60): number {
    return (shiftHours * 60) - plannedBreakMinutes;
  }
}

/**
 * OEE 계산 결과 캐싱을 위한 클래스
 */
export class OEECache {
  private static cache = new Map<string, { data: OEEMetrics; timestamp: number }>();
  private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5분

  /**
   * 캐시에서 OEE 데이터 조회
   * @param key 캐시 키
   * @returns 캐시된 OEE 데이터 또는 null
   */
  static get(key: string): OEEMetrics | null {
    const cached = this.cache.get(key);
    
    if (!cached) {
      return null;
    }

    const now = Date.now();
    if (now - cached.timestamp > this.CACHE_DURATION) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * OEE 데이터를 캐시에 저장
   * @param key 캐시 키
   * @param data OEE 데이터
   */
  static set(key: string, data: OEEMetrics): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * 특정 키의 캐시 삭제
   * @param key 캐시 키
   */
  static delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * 모든 캐시 삭제
   */
  static clear(): void {
    this.cache.clear();
  }

  /**
   * 만료된 캐시 항목 정리
   */
  static cleanup(): void {
    const now = Date.now();
    
    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.CACHE_DURATION) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * 실시간 OEE 계산을 위한 헬퍼 함수들
 */
export class RealTimeOEECalculator {
  /**
   * 설비별 실시간 OEE 계산
   * @param machineId 설비 ID
   * @param machineLogs 설비 로그 배열
   * @param productionRecord 생산 실적 (선택사항)
   * @param tactTime 택트 타임 (초)
   * @returns 실시간 OEE 지표
   */
  static calculateRealTimeOEE(
    machineId: string,
    machineLogs: MachineLog[],
    productionRecord?: Partial<ProductionRecord>,
    tactTime: number = 30
  ): OEEMetrics {
    const cacheKey = `realtime_${machineId}_${Date.now().toString().slice(0, -4)}0000`; // 10초 단위로 캐싱
    
    // 캐시에서 먼저 확인
    const cached = OEECache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 현재 교대 시간 계산
    const now = new Date();
    const shiftStart = this.getCurrentShiftStart(now);
    const shiftEnd = new Date(shiftStart.getTime() + 12 * 60 * 60 * 1000); // 12시간 교대

    // 실제 가동시간 계산
    const actualRuntime = OEECalculator.calculateActualRuntimeFromLogs(
      machineLogs,
      shiftStart,
      now
    );

    // 계획 가동시간 계산 (현재 시간까지)
    const elapsedMinutes = (now.getTime() - shiftStart.getTime()) / (1000 * 60);
    const plannedRuntime = Math.min(elapsedMinutes, OEECalculator.calculatePlannedRuntime());

    // 생산 실적 데이터
    const outputQty = productionRecord?.output_qty || 0;
    const defectQty = productionRecord?.defect_qty || 0;

    // 이론 생산시간 계산
    const idealRuntime = OEECalculator.calculateIdealRuntime(outputQty, tactTime);

    // OEE 계산
    const availability = OEECalculator.calculateAvailability(actualRuntime, plannedRuntime);
    const performance = OEECalculator.calculatePerformance(idealRuntime, actualRuntime);
    const quality = OEECalculator.calculateQuality(outputQty, defectQty);
    const oee = OEECalculator.calculateOEE(availability, performance, quality);

    const result: OEEMetrics = {
      availability,
      performance,
      quality,
      oee,
      actual_runtime: actualRuntime,
      planned_runtime: plannedRuntime,
      ideal_runtime: idealRuntime,
      output_qty: outputQty,
      defect_qty: defectQty
    };

    // 결과 캐싱
    OEECache.set(cacheKey, result);

    return result;
  }

  /**
   * 현재 교대 시작 시간 계산
   * @param currentTime 현재 시간
   * @returns 교대 시작 시간
   */
  private static getCurrentShiftStart(currentTime: Date): Date {
    const hour = currentTime.getHours();
    const shiftStart = new Date(currentTime);
    
    if (hour >= 8 && hour < 20) {
      // A교대 (08:00-20:00)
      shiftStart.setHours(8, 0, 0, 0);
    } else {
      // B교대 (20:00-08:00)
      if (hour >= 20) {
        shiftStart.setHours(20, 0, 0, 0);
      } else {
        // 다음날 새벽인 경우 전날 20:00으로 설정
        shiftStart.setDate(shiftStart.getDate() - 1);
        shiftStart.setHours(20, 0, 0, 0);
      }
    }
    
    return shiftStart;
  }
}