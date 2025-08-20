// Database types
export * from './database';

// 사용자 관련 타입
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'engineer';
  assigned_machines?: string[];
  created_at: string;
}

// 설비 상태 타입
export type MachineState = 
  | 'NORMAL_OPERATION'    // 정상가동
  | 'MAINTENANCE'         // 점검중
  | 'MODEL_CHANGE'        // 모델교체
  | 'PLANNED_STOP'        // 계획정지
  | 'PROGRAM_CHANGE'      // 프로그램 교체
  | 'TOOL_CHANGE'         // 공구교환
  | 'TEMPORARY_STOP';     // 일시정지

// 설비 정보 타입
export interface Machine {
  id: string;
  name: string;
  location: string;
  model_type: string;
  processing_step: string;
  default_tact_time: number;
  is_active: boolean;
  current_state?: MachineState;
  created_at: string;
  updated_at: string;
}

// 설비 로그 타입
export interface MachineLog {
  log_id: string;
  machine_id: string;
  state: MachineState;
  start_time: string;
  end_time?: string;
  duration?: number;
  operator_id: string;
  created_at: string;
}

// 생산 실적 타입
export interface ProductionRecord {
  record_id: string;
  machine_id: string;
  date: string;
  shift: 'A' | 'B';
  planned_runtime?: number;
  actual_runtime?: number;
  ideal_runtime?: number;
  output_qty: number;
  defect_qty: number;
  availability?: number;
  performance?: number;
  quality?: number;
  oee?: number;
  created_at: string;
}

// OEE 지표 타입
export interface OEEMetrics {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  actual_runtime: number;
  planned_runtime: number;
  ideal_runtime: number;
  output_qty: number;
  defect_qty: number;
}

// 인증 컨텍스트 타입
export interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

// 언어 컨텍스트 타입
export interface LanguageContextType {
  language: 'ko' | 'vi';
  changeLanguage: (lang: 'ko' | 'vi') => void;
  t: (key: string, options?: any) => string;
}

// 에러 타입
export interface AppError {
  code: string;
  message: string;
  details?: any;
}

export enum ErrorCodes {
  AUTHENTICATION_FAILED = 'AUTH_001',
  UNAUTHORIZED_ACCESS = 'AUTH_002',
  MACHINE_NOT_FOUND = 'MACHINE_001',
  INVALID_STATE_TRANSITION = 'MACHINE_002',
  OEE_CALCULATION_ERROR = 'OEE_001',
  DATABASE_ERROR = 'DB_001'
}