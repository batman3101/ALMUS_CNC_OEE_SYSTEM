/**
 * 날짜/시간 유틸리티 함수들
 * 시스템 설정의 timezone, date_format, time_format을 활용하여 일관된 날짜/시간 표시 제공
 */

import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import relativeTime from 'dayjs/plugin/relativeTime';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import 'dayjs/locale/ko';
import 'dayjs/locale/vi';

// dayjs 플러그인 로드
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.extend(customParseFormat);
dayjs.extend(localizedFormat);

// 기본 설정값
const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_DATE_FORMAT = 'DD/MM/YYYY';
const DEFAULT_TIME_FORMAT = 'HH:mm:ss';
const DEFAULT_LANGUAGE = 'vi';

/**
 * 날짜/시간 포맷터 클래스
 */
export class DateTimeFormatter {
  private timezone: string;
  private dateFormat: string;
  private timeFormat: string;
  private language: string;

  constructor(
    timezone?: string,
    dateFormat?: string,
    timeFormat?: string,
    language?: string
  ) {
    this.timezone = timezone || DEFAULT_TIMEZONE;
    this.dateFormat = dateFormat || DEFAULT_DATE_FORMAT;
    this.timeFormat = timeFormat || DEFAULT_TIME_FORMAT;
    this.language = language || DEFAULT_LANGUAGE;
    
    // dayjs 로케일 설정
    dayjs.locale(this.language);
  }

  /**
   * 설정 업데이트
   */
  updateSettings(settings: {
    timezone?: string;
    dateFormat?: string;
    timeFormat?: string;
    language?: string;
  }) {
    if (settings.timezone) this.timezone = settings.timezone;
    if (settings.dateFormat) this.dateFormat = settings.dateFormat;
    if (settings.timeFormat) this.timeFormat = settings.timeFormat;
    if (settings.language) {
      this.language = settings.language;
      dayjs.locale(this.language);
    }
  }

  /**
   * Date 객체를 dayjs 객체로 변환 (타임존 적용)
   */
  private toDayjs(date: Date | string | Dayjs): Dayjs {
    return dayjs(date).tz(this.timezone);
  }

  /**
   * 날짜만 포맷팅
   */
  formatDate(date: Date | string | Dayjs): string {
    return this.toDayjs(date).format(this.dateFormat);
  }

  /**
   * 시간만 포맷팅
   */
  formatTime(date: Date | string | Dayjs): string {
    return this.toDayjs(date).format(this.timeFormat);
  }

  /**
   * 날짜+시간 포맷팅
   */
  formatDateTime(date: Date | string | Dayjs): string {
    return this.toDayjs(date).format(`${this.dateFormat} ${this.timeFormat}`);
  }

  /**
   * 상대 시간 표시 (예: "2분 전", "1시간 후")
   */
  formatRelative(date: Date | string | Dayjs): string {
    return this.toDayjs(date).fromNow();
  }

  /**
   * 달력 형식 표시 (예: "오늘", "어제", "내일")
   */
  formatCalendar(date: Date | string | Dayjs): string {
    const dayjsDate = this.toDayjs(date);
    const now = dayjs().tz(this.timezone);
    const diff = now.diff(dayjsDate, 'day');

    if (diff === 0) {
      return this.language === 'ko' ? '오늘' : 'Hôm nay';
    } else if (diff === 1) {
      return this.language === 'ko' ? '어제' : 'Hôm qua';
    } else if (diff === -1) {
      return this.language === 'ko' ? '내일' : 'Ngày mai';
    } else if (Math.abs(diff) <= 7) {
      // 이번 주
      return dayjsDate.format('dddd');
    } else {
      // 그 이상은 날짜로
      return this.formatDate(dayjsDate);
    }
  }

  /**
   * 커스텀 포맷 적용
   */
  format(date: Date | string | Dayjs, customFormat: string): string {
    return this.toDayjs(date).format(customFormat);
  }

  /**
   * 현재 시간 (타임존 적용)
   */
  now(): Dayjs {
    return dayjs().tz(this.timezone);
  }

  /**
   * 타임존 변환
   */
  convertTimezone(date: Date | string | Dayjs, targetTimezone: string): Dayjs {
    return dayjs(date).tz(targetTimezone);
  }

  /**
   * 날짜 범위 포맷팅
   */
  formatDateRange(startDate: Date | string | Dayjs, endDate: Date | string | Dayjs): string {
    const start = this.toDayjs(startDate);
    const end = this.toDayjs(endDate);

    // 같은 날인 경우
    if (start.isSame(end, 'day')) {
      return `${this.formatDate(start)} ${this.formatTime(start)} - ${this.formatTime(end)}`;
    }
    
    // 다른 날인 경우
    return `${this.formatDateTime(start)} - ${this.formatDateTime(end)}`;
  }

  /**
   * Ant Design DatePicker용 형식 변환
   */
  getAntdDateFormat(): string {
    // dayjs 형식을 Ant Design 형식으로 변환
    return this.dateFormat
      .replace(/YYYY/g, 'YYYY')
      .replace(/MM/g, 'MM')
      .replace(/DD/g, 'DD');
  }

  /**
   * Ant Design TimePicker용 형식 변환
   */
  getAntdTimeFormat(): string {
    return this.timeFormat
      .replace(/HH/g, 'HH')
      .replace(/hh/g, 'hh')
      .replace(/mm/g, 'mm')
      .replace(/ss/g, 'ss')
      .replace(/A/g, 'A');
  }

  /**
   * 입력된 날짜 문자열 파싱 (현재 설정 형식으로)
   */
  parseDate(dateString: string): Dayjs | null {
    try {
      const parsed = dayjs(dateString, this.dateFormat, true);
      return parsed.isValid() ? parsed.tz(this.timezone) : null;
    } catch {
      return null;
    }
  }

  /**
   * 입력된 시간 문자열 파싱 (현재 설정 형식으로)
   */
  parseTime(timeString: string): Dayjs | null {
    try {
      const parsed = dayjs(timeString, this.timeFormat, true);
      return parsed.isValid() ? parsed.tz(this.timezone) : null;
    } catch {
      return null;
    }
  }

  /**
   * 날짜/시간 문자열 파싱 (현재 설정 형식으로)
   */
  parseDateTime(dateTimeString: string): Dayjs | null {
    try {
      const format = `${this.dateFormat} ${this.timeFormat}`;
      const parsed = dayjs(dateTimeString, format, true);
      return parsed.isValid() ? parsed.tz(this.timezone) : null;
    } catch {
      return null;
    }
  }

  /**
   * 유효성 검사
   */
  isValid(date: any): boolean {
    return dayjs(date).isValid();
  }

  /**
   * 설정 정보 조회
   */
  getSettings() {
    return {
      timezone: this.timezone,
      dateFormat: this.dateFormat,
      timeFormat: this.timeFormat,
      language: this.language
    };
  }
}

/**
 * 기본 포맷터 인스턴스 (싱글톤)
 */
let defaultFormatter: DateTimeFormatter;

/**
 * 기본 포맷터 초기화/업데이트
 */
export function initializeDateTimeFormatter(settings?: {
  timezone?: string;
  dateFormat?: string;
  timeFormat?: string;
  language?: string;
}) {
  if (!defaultFormatter) {
    defaultFormatter = new DateTimeFormatter(
      settings?.timezone,
      settings?.dateFormat,
      settings?.timeFormat,
      settings?.language
    );
  } else {
    defaultFormatter.updateSettings(settings || {});
  }
  return defaultFormatter;
}

/**
 * 기본 포맷터 조회
 */
export function getDateTimeFormatter(): DateTimeFormatter {
  if (!defaultFormatter) {
    defaultFormatter = new DateTimeFormatter();
  }
  return defaultFormatter;
}

/**
 * 편의 함수들 (기본 포맷터 사용)
 */
export const formatDate = (date: Date | string | Dayjs) => 
  getDateTimeFormatter().formatDate(date);

export const formatTime = (date: Date | string | Dayjs) => 
  getDateTimeFormatter().formatTime(date);

export const formatDateTime = (date: Date | string | Dayjs) => 
  getDateTimeFormatter().formatDateTime(date);

export const formatRelative = (date: Date | string | Dayjs) => 
  getDateTimeFormatter().formatRelative(date);

export const formatCalendar = (date: Date | string | Dayjs) => 
  getDateTimeFormatter().formatCalendar(date);

export const formatDateRange = (
  startDate: Date | string | Dayjs, 
  endDate: Date | string | Dayjs
) => getDateTimeFormatter().formatDateRange(startDate, endDate);

export const formatCustom = (date: Date | string | Dayjs, format: string) => 
  getDateTimeFormatter().format(date, format);

export const parseDate = (dateString: string) => 
  getDateTimeFormatter().parseDate(dateString);

export const parseTime = (timeString: string) => 
  getDateTimeFormatter().parseTime(timeString);

export const parseDateTime = (dateTimeString: string) => 
  getDateTimeFormatter().parseDateTime(dateTimeString);

export const isValidDate = (date: any) => 
  getDateTimeFormatter().isValid(date);

export const getCurrentTime = () => 
  getDateTimeFormatter().now();

export const convertTimezone = (date: Date | string | Dayjs, targetTimezone: string) => 
  getDateTimeFormatter().convertTimezone(date, targetTimezone);

/**
 * 차트용 시간축 포매터
 */
export const getChartTimeFormat = (granularity: 'minute' | 'hour' | 'day' | 'month'): string => {
  const formatter = getDateTimeFormatter();
  const settings = formatter.getSettings();
  
  switch (granularity) {
    case 'minute':
      return settings.timeFormat;
    case 'hour':
      return 'HH:mm';
    case 'day':
      return settings.dateFormat;
    case 'month':
      return 'MM/YYYY';
    default:
      return `${settings.dateFormat} ${settings.timeFormat}`;
  }
};

/**
 * 교대 시간 계산 유틸리티
 */
export const calculateShiftTime = (
  baseDate: Date | string | Dayjs,
  shiftStart: string,
  shiftEnd: string
): { start: Dayjs; end: Dayjs } => {
  const formatter = getDateTimeFormatter();
  const base = formatter.toDayjs(baseDate).startOf('day');
  
  const [startHour, startMinute] = shiftStart.split(':').map(Number);
  const [endHour, endMinute] = shiftEnd.split(':').map(Number);
  
  const start = base.hour(startHour).minute(startMinute).second(0);
  let end = base.hour(endHour).minute(endMinute).second(0);
  
  // 교대가 자정을 넘는 경우
  if (endHour < startHour) {
    end = end.add(1, 'day');
  }
  
  return { start, end };
};

/**
 * 업무 시간 계산 (휴식 시간 제외)
 */
export const calculateWorkingHours = (
  startTime: Date | string | Dayjs,
  endTime: Date | string | Dayjs,
  breakMinutes: number = 0
): number => {
  const formatter = getDateTimeFormatter();
  const start = formatter.toDayjs(startTime);
  const end = formatter.toDayjs(endTime);
  
  const totalMinutes = end.diff(start, 'minute');
  const workingMinutes = Math.max(0, totalMinutes - breakMinutes);
  
  return workingMinutes / 60; // 시간으로 변환
};