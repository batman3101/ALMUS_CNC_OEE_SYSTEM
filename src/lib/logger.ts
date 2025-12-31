/**
 * 프로덕션 환경을 위한 로깅 시스템
 * 개발 환경에서는 console 출력, 프로덕션에서는 외부 로깅 서비스 연동 준비
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
  category?: string;
  userId?: string;
  sessionId?: string;
}

class Logger {
  private static instance: Logger;
  private logLevel: LogLevel;
  private isProduction: boolean;
  private logBuffer: LogEntry[] = [];
  private readonly MAX_BUFFER_SIZE = 1000;

  private constructor() {
    this.isProduction = process.env.NODE_ENV === 'production';
    this.logLevel = this.isProduction ? LogLevel.WARN : LogLevel.DEBUG;
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];
    const dataStr = data ? ` | Data: ${JSON.stringify(data)}` : '';
    return `[${timestamp}] ${levelName}: ${message}${dataStr}`;
  }

  private addToBuffer(entry: LogEntry): void {
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.MAX_BUFFER_SIZE) {
      this.logBuffer.shift(); // 오래된 로그 제거
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sendToExternalService(_entry: LogEntry): Promise<void> {
    // 프로덕션 환경에서 외부 로깅 서비스로 전송
    // 예: Sentry, LogRocket, DataDog 등
    if (this.isProduction) {
      // TODO: 실제 로깅 서비스 연동
      // await externalLoggingService.send(_entry);
    }
  }

  public debug(message: string, data?: unknown, category?: string): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.DEBUG,
      message,
      data,
      category,
    };

    this.addToBuffer(entry);

    if (!this.isProduction) {
      console.debug(this.formatMessage(LogLevel.DEBUG, message, data));
    }
  }

  public info(message: string, data?: unknown, category?: string): void {
    if (!this.shouldLog(LogLevel.INFO)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      message,
      data,
      category,
    };

    this.addToBuffer(entry);

    if (!this.isProduction) {
      console.info(this.formatMessage(LogLevel.INFO, message, data));
    }

    this.sendToExternalService(entry);
  }

  public warn(message: string, data?: unknown, category?: string): void {
    if (!this.shouldLog(LogLevel.WARN)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.WARN,
      message,
      data,
      category,
    };

    this.addToBuffer(entry);

    if (!this.isProduction) {
      console.warn(this.formatMessage(LogLevel.WARN, message, data));
    } else {
      // 프로덕션에서는 경고와 오류만 console에 출력
      console.warn(this.formatMessage(LogLevel.WARN, message, data));
    }

    this.sendToExternalService(entry);
  }

  public error(message: string, error?: Error | unknown, category?: string): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;

    const errorData = error instanceof Error 
      ? { name: error.name, message: error.message, stack: error.stack }
      : error;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.ERROR,
      message,
      data: errorData,
      category,
    };

    this.addToBuffer(entry);

    // 오류는 항상 console에 출력
    console.error(this.formatMessage(LogLevel.ERROR, message, errorData));

    this.sendToExternalService(entry);
  }

  // 사용자 정보 설정
  public setUser(userId: string, sessionId?: string): void {
    this.logBuffer.forEach(entry => {
      entry.userId = userId;
      if (sessionId) entry.sessionId = sessionId;
    });
  }

  // 로그 레벨 변경
  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  // 로그 버퍼 가져오기 (디버깅용)
  public getLogBuffer(): LogEntry[] {
    return [...this.logBuffer];
  }

  // 특정 카테고리의 로그만 가져오기
  public getLogsByCategory(category: string): LogEntry[] {
    return this.logBuffer.filter(entry => entry.category === category);
  }

  // 로그 버퍼 클리어
  public clearBuffer(): void {
    this.logBuffer = [];
  }
}

// 싱글톤 인스턴스 생성
const logger = Logger.getInstance();

// 편의 함수들 내보내기
export const log = {
  debug: (message: string, data?: unknown, category?: string) => logger.debug(message, data, category),
  info: (message: string, data?: unknown, category?: string) => logger.info(message, data, category),
  warn: (message: string, data?: unknown, category?: string) => logger.warn(message, data, category),
  error: (message: string, error?: Error | unknown, category?: string) => logger.error(message, error, category),
  setUser: (userId: string, sessionId?: string) => logger.setUser(userId, sessionId),
  setLogLevel: (level: LogLevel) => logger.setLogLevel(level),
  getLogBuffer: () => logger.getLogBuffer(),
  getLogsByCategory: (category: string) => logger.getLogsByCategory(category),
  clearBuffer: () => logger.clearBuffer(),
};

export default logger;

// 카테고리 상수
export const LogCategories = {
  AUTH: 'auth',
  API: 'api',
  UI: 'ui',
  OEE: 'oee',
  MACHINE: 'machine',
  PRODUCTION: 'production',
  SYSTEM: 'system',
  NOTIFICATION: 'notification',
  SETTINGS: 'settings',
} as const;

export type LogCategory = typeof LogCategories[keyof typeof LogCategories];