'use client';

import { useMemo } from 'react';
import dayjs from 'dayjs';
import { useSystemSettings } from './useSystemSettings';

/**
 * 교대 시간 관리 훅
 */
export function useShiftTime() {
  const { getShiftTimes } = useSystemSettings();

  const shiftTimes = getShiftTimes();

  const shiftUtils = useMemo(() => ({
    /**
     * 현재 교대 반환
     */
    getCurrentShift: (): 'A' | 'B' => {
      const now = dayjs();
      const currentTime = now.format('HH:mm');
      
      // A교대 시간 체크
      if (currentTime >= shiftTimes.shiftA.start && currentTime < shiftTimes.shiftA.end) {
        return 'A';
      }
      // B교대 시간 체크 (나머지 시간)
      return 'B';
    },

    /**
     * 특정 시간의 교대 반환
     */
    getShiftAtTime: (dateTime: dayjs.Dayjs): 'A' | 'B' => {
      const timeStr = dateTime.format('HH:mm');
      
      if (timeStr >= shiftTimes.shiftA.start && timeStr < shiftTimes.shiftA.end) {
        return 'A';
      }
      return 'B';
    },

    /**
     * 교대 시작/종료 시간 반환
     */
    getShiftTimeRange: (date: dayjs.Dayjs, shift: 'A' | 'B') => {
      const baseDate = date.startOf('day');
      
      if (shift === 'A') {
        const [startHour, startMinute] = shiftTimes.shiftA.start.split(':').map(Number);
        const [endHour, endMinute] = shiftTimes.shiftA.end.split(':').map(Number);
        
        return {
          start: baseDate.hour(startHour).minute(startMinute).second(0),
          end: baseDate.hour(endHour).minute(endMinute).second(0)
        };
      } else {
        const [startHour, startMinute] = shiftTimes.shiftB.start.split(':').map(Number);
        const [endHour, endMinute] = shiftTimes.shiftB.end.split(':').map(Number);
        
        const start = baseDate.hour(startHour).minute(startMinute).second(0);
        // B교대는 다음날까지 이어짐
        const end = baseDate.add(1, 'day').hour(endHour).minute(endMinute).second(0);
        
        return { start, end };
      }
    },

    /**
     * 교대 지속 시간 계산 (분 단위)
     */
    getShiftDuration: (shift: 'A' | 'B'): number => {
      if (shift === 'A') {
        const start = dayjs(`2000-01-01 ${shiftTimes.shiftA.start}`);
        const end = dayjs(`2000-01-01 ${shiftTimes.shiftA.end}`);
        return end.diff(start, 'minute');
      } else {
        const start = dayjs(`2000-01-01 ${shiftTimes.shiftB.start}`);
        const end = dayjs(`2000-01-02 ${shiftTimes.shiftB.end}`);
        return end.diff(start, 'minute');
      }
    },

    /**
     * 실제 작업 시간 계산 (휴식 시간 제외)
     */
    getWorkingTime: (shift: 'A' | 'B'): number => {
      const totalDuration = shiftUtils.getShiftDuration(shift);
      return Math.max(0, totalDuration - shiftTimes.breakTime);
    },

    /**
     * 교대 교체 시간 여부 확인
     */
    isShiftChangeTime: (dateTime: dayjs.Dayjs = dayjs()): boolean => {
      const timeStr = dateTime.format('HH:mm');
      const bufferMinutes = shiftTimes.bufferTime;
      
      // A교대 시작 시간 전후 버퍼
      const aStartTime = dayjs(`2000-01-01 ${shiftTimes.shiftA.start}`);
      const aStartBuffer = aStartTime.subtract(bufferMinutes, 'minute').format('HH:mm');
      const aStartBufferEnd = aStartTime.add(bufferMinutes, 'minute').format('HH:mm');
      
      // B교대 시작 시간 전후 버퍼
      const bStartTime = dayjs(`2000-01-01 ${shiftTimes.shiftB.start}`);
      const bStartBuffer = bStartTime.subtract(bufferMinutes, 'minute').format('HH:mm');
      const bStartBufferEnd = bStartTime.add(bufferMinutes, 'minute').format('HH:mm');
      
      return (timeStr >= aStartBuffer && timeStr <= aStartBufferEnd) ||
             (timeStr >= bStartBuffer && timeStr <= bStartBufferEnd);
    },

    /**
     * 다음 교대 교체 시간 반환
     */
    getNextShiftChange: (fromTime: dayjs.Dayjs = dayjs()): dayjs.Dayjs => {
      const currentShift = shiftUtils.getCurrentShift();
      const today = fromTime.startOf('day');
      
      if (currentShift === 'A') {
        // A교대 중이면 B교대 시작 시간
        const [hour, minute] = shiftTimes.shiftB.start.split(':').map(Number);
        const nextChange = today.hour(hour).minute(minute).second(0);
        
        return nextChange.isAfter(fromTime) ? nextChange : nextChange.add(1, 'day');
      } else {
        // B교대 중이면 다음날 A교대 시작 시간
        const [hour, minute] = shiftTimes.shiftA.start.split(':').map(Number);
        const nextChange = today.add(1, 'day').hour(hour).minute(minute).second(0);
        
        return nextChange;
      }
    },

    /**
     * 교대 종료까지 남은 시간 반환
     */
    getTimeUntilShiftEnd: (fromTime: dayjs.Dayjs = dayjs()): number => {
      const currentShift = shiftUtils.getCurrentShift();
      const shiftRange = shiftUtils.getShiftTimeRange(fromTime, currentShift);
      
      return shiftRange.end.diff(fromTime, 'minute');
    },

    /**
     * 특정 날짜의 교대별 시간 범위 반환
     */
    getDayShiftRanges: (date: dayjs.Dayjs) => {
      return {
        A: shiftUtils.getShiftTimeRange(date, 'A'),
        B: shiftUtils.getShiftTimeRange(date, 'B')
      };
    },

    /**
     * 교대 정보 요약
     */
    getShiftSummary: () => {
      const aDuration = shiftUtils.getShiftDuration('A');
      const bDuration = shiftUtils.getShiftDuration('B');
      const aWorkingTime = shiftUtils.getWorkingTime('A');
      const bWorkingTime = shiftUtils.getWorkingTime('B');
      
      return {
        shifts: {
          A: {
            start: shiftTimes.shiftA.start,
            end: shiftTimes.shiftA.end,
            duration: aDuration,
            workingTime: aWorkingTime,
            breakTime: shiftTimes.breakTime
          },
          B: {
            start: shiftTimes.shiftB.start,
            end: shiftTimes.shiftB.end,
            duration: bDuration,
            workingTime: bWorkingTime,
            breakTime: shiftTimes.breakTime
          }
        },
        total: {
          coverage: 24 * 60, // 24시간
          workingTime: aWorkingTime + bWorkingTime,
          breakTime: shiftTimes.breakTime * 2,
          efficiency: ((aWorkingTime + bWorkingTime) / (24 * 60)) * 100
        },
        bufferTime: shiftTimes.bufferTime
      };
    }
  }), [shiftTimes]);

  return {
    shiftTimes,
    ...shiftUtils
  };
}