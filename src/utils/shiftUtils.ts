import { setHours, setMinutes, setSeconds, isAfter, isBefore, format } from 'date-fns';

export interface ShiftInfo {
  shift: 'A' | 'B';
  startTime: Date;
  endTime: Date;
  isActive: boolean;
}

/**
 * 현재 시간을 기준으로 교대 정보를 반환합니다
 * A조: 08:00 - 20:00
 * B조: 20:00 - 08:00 (다음날)
 */
export const getCurrentShiftInfo = (currentTime: Date = new Date()): ShiftInfo => {
  const today = new Date(currentTime);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  
  // A조 시간 설정 (08:00 - 20:00)
  const aShiftStart = setSeconds(setMinutes(setHours(today, 8), 0), 0);
  const aShiftEnd = setSeconds(setMinutes(setHours(today, 20), 0), 0);
  
  // B조 시간 설정 (20:00 - 08:00 다음날)
  const bShiftStart = setSeconds(setMinutes(setHours(today, 20), 0), 0);
  const bShiftEnd = setSeconds(setMinutes(setHours(tomorrow, 8), 0), 0);

  if (isAfter(currentTime, aShiftStart) && isBefore(currentTime, aShiftEnd)) {
    // A조 시간대
    return {
      shift: 'A',
      startTime: aShiftStart,
      endTime: aShiftEnd,
      isActive: true
    };
  } else {
    // B조 시간대
    return {
      shift: 'B',
      startTime: bShiftStart,
      endTime: bShiftEnd,
      isActive: true
    };
  }
};

/**
 * 교대 종료까지 남은 시간을 분 단위로 반환합니다
 */
export const getTimeUntilShiftEnd = (currentTime: Date = new Date()): number => {
  const shiftInfo = getCurrentShiftInfo(currentTime);
  const timeUntilEnd = shiftInfo.endTime.getTime() - currentTime.getTime();
  return Math.max(0, Math.floor(timeUntilEnd / (1000 * 60))); // 분 단위로 변환
};

/**
 * 교대 종료 알림이 필요한지 확인합니다 (종료 15분 전)
 */
export const shouldShowShiftEndNotification = (currentTime: Date = new Date()): boolean => {
  const minutesUntilEnd = getTimeUntilShiftEnd(currentTime);
  return minutesUntilEnd > 0 && minutesUntilEnd <= 15;
};

/**
 * 교대 시간 표시용 문자열을 반환합니다
 */
export const formatShiftTime = (shiftInfo: ShiftInfo): string => {
  const startTime = format(shiftInfo.startTime, 'HH:mm');
  const endTime = format(shiftInfo.endTime, 'HH:mm');
  return `${shiftInfo.shift}조 (${startTime} - ${endTime})`;
};

/**
 * 특정 날짜의 교대별 시간 범위를 반환합니다
 */
export const getShiftTimeRanges = (date: Date) => {
  const targetDate = new Date(date);
  const nextDay = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
  
  return {
    A: {
      start: setSeconds(setMinutes(setHours(targetDate, 8), 0), 0),
      end: setSeconds(setMinutes(setHours(targetDate, 20), 0), 0)
    },
    B: {
      start: setSeconds(setMinutes(setHours(targetDate, 20), 0), 0),
      end: setSeconds(setMinutes(setHours(nextDay, 8), 0), 0)
    }
  };
};

/**
 * 교대 시간 내에서 실제 가동 시간을 계산합니다 (분 단위)
 */
export const calculateActualRuntime = (
  shiftStart: Date,
  shiftEnd: Date,
  downtimeMinutes: number = 0
): number => {
  const totalShiftMinutes = (shiftEnd.getTime() - shiftStart.getTime()) / (1000 * 60);
  return Math.max(0, totalShiftMinutes - downtimeMinutes);
};