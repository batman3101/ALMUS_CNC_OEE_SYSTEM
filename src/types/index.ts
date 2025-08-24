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

// 설비 상태 타입 (데이터베이스 enum과 일치)
export type MachineState = 
  | 'NORMAL_OPERATION'    // 정상가동
  | 'INSPECTION'          // 점검중  
  | 'BREAKDOWN_REPAIR'    // 고장수리중
  | 'PM_MAINTENANCE'      // PM중
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
  equipment_type?: string;           // 설비 타입 (선택사항)
  production_model_id?: string;      // 생산 모델 ID
  current_process_id?: string;       // 현재 공정 ID
  is_active: boolean;
  current_state?: MachineState;
  created_at: string;
  updated_at: string;
  
  // 조인된 정보들 (뷰에서 가져올 때)
  production_model_name?: string;
  production_model_description?: string;
  current_process_name?: string;
  current_process_order?: number;
  current_tact_time?: number;
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