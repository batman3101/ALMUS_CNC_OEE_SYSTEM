import { format } from 'date-fns';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { getBusinessDateAt, getShiftAt } from './downtimeIntervals';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface ShiftInfo {
  shift: 'A' | 'B';
  startTime: Date;
  endTime: Date;
  isActive: boolean;
  businessDate: string;
}

/**
 * 교대 시간 계산에 필요한 설정값 (시스템 설정 기반)
 * timezone/shift 시간은 useSystemSettings 의 getCompanyInfo/getShiftTimes 에서 온다.
 */
export interface ShiftTimeConfig {
  timezone: string;
  shiftAStart: string;
  shiftAEnd: string;
  shiftBStart: string;
  shiftBEnd: string;
}

const toMinutes = (time: string): number => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

/** 설정된 시간대에서 특정 업무일자(YYYY-MM-DD)의 벽시계 시각을 실제 Date 로 만든다. */
const atZonedTime = (
  date: string,
  timezoneName: string,
  time: string,
  dayOffset = 0
): Date => {
  const [hour, minute] = time.split(':').map(Number);
  return dayjs
    .tz(date, timezoneName)
    .add(dayOffset, 'day')
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0)
    .toDate();
};

/**
 * 현재 시간을 기준으로 교대 정보를 반환합니다 (설정된 시간대·교대 시간 기준)
 * 기본값(A조 08:00-20:00, B조 20:00-08:00)에서는 기존 하드코딩 동작과 동일합니다.
 */
export const getCurrentShiftInfo = (
  currentTime: Date,
  config: ShiftTimeConfig
): ShiftInfo => {
  const shift = getShiftAt(
    currentTime,
    config.timezone,
    config.shiftAStart,
    config.shiftBStart
  );
  const businessDate = getBusinessDateAt(
    currentTime,
    config.timezone,
    config.shiftAStart
  );

  let startTime: Date;
  let endTime: Date;

  if (shift === 'A') {
    // A조는 업무일자 당일에 진행된다
    const endOffset =
      toMinutes(config.shiftAEnd) <= toMinutes(config.shiftAStart) ? 1 : 0;
    startTime = atZonedTime(businessDate, config.timezone, config.shiftAStart);
    endTime = atZonedTime(businessDate, config.timezone, config.shiftAEnd, endOffset);
  } else {
    // B조는 업무일자 당일에 시작해 자정을 넘겨 다음날에 끝난다 (기본 20:00 -> 08:00)
    const endOffset =
      toMinutes(config.shiftBEnd) <= toMinutes(config.shiftBStart) ? 1 : 0;
    startTime = atZonedTime(businessDate, config.timezone, config.shiftBStart);
    endTime = atZonedTime(businessDate, config.timezone, config.shiftBEnd, endOffset);
  }

  return {
    shift,
    startTime,
    endTime,
    isActive: true,
    businessDate
  };
};

/**
 * 교대 종료까지 남은 시간을 분 단위로 반환합니다
 */
export const getTimeUntilShiftEnd = (
  currentTime: Date,
  config: ShiftTimeConfig
): number => {
  const shiftInfo = getCurrentShiftInfo(currentTime, config);
  const timeUntilEnd = shiftInfo.endTime.getTime() - currentTime.getTime();
  return Math.max(0, Math.floor(timeUntilEnd / (1000 * 60))); // 분 단위로 변환
};

/**
 * 교대 종료 알림이 필요한지 확인합니다 (종료 15분 전)
 */
export const shouldShowShiftEndNotification = (
  currentTime: Date,
  config: ShiftTimeConfig
): boolean => {
  const minutesUntilEnd = getTimeUntilShiftEnd(currentTime, config);
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
 * 특정 날짜의 교대별 시간 범위를 반환합니다 (설정된 시간대·교대 시간 기준)
 */
export const getShiftTimeRanges = (date: Date, config: ShiftTimeConfig) => {
  const dateStr = dayjs(date).tz(config.timezone).format('YYYY-MM-DD');
  const aEndOffset =
    toMinutes(config.shiftAEnd) <= toMinutes(config.shiftAStart) ? 1 : 0;
  const bEndOffset =
    toMinutes(config.shiftBEnd) <= toMinutes(config.shiftBStart) ? 1 : 0;

  return {
    A: {
      start: atZonedTime(dateStr, config.timezone, config.shiftAStart),
      end: atZonedTime(dateStr, config.timezone, config.shiftAEnd, aEndOffset)
    },
    B: {
      start: atZonedTime(dateStr, config.timezone, config.shiftBStart),
      end: atZonedTime(dateStr, config.timezone, config.shiftBEnd, bEndOffset)
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
