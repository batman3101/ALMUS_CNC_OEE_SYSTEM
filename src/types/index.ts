// Database types
export * from './database';

// Supabase 조인 결과 헬퍼 (Joined<T>, unwrapJoin)
export * from './supabaseJoin';
import type { Joined } from './supabaseJoin';

// 사용자 관련 타입
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'engineer';
  assigned_machines?: string[];
  created_at: string;

  // 개인 환경설정. 전역 system_settings 가 아니라 user_profiles 에 사용자별로 저장한다.
  // null = 아직 고르지 않음 -> system_settings 의 값을 "기본값"으로 사용한다.
  language?: 'ko' | 'vi' | null;
  theme_mode?: 'light' | 'dark' | null;
}

// 설비 상태 (DB enum `machine_status` 와 1:1 일치)
//
// ⚠️ 'MAINTENANCE' / 'ERROR' / 'IDLE' / 'SETUP' 은 DB enum 에 **존재하지 않는다**.
//    (점검은 INSPECTION, PM 은 PM_MAINTENANCE, 고장은 BREAKDOWN_REPAIR)
//
// 런타임 검증에는 아래 MACHINE_STATES / isMachineState 를 쓸 것.
// 문자열 배열을 손으로 다시 나열하면 타입 검사를 우회해 버린다.
export const MACHINE_STATES = [
  'NORMAL_OPERATION',    // 정상가동
  'INSPECTION',          // 점검중
  'BREAKDOWN_REPAIR',    // 고장수리중
  'PM_MAINTENANCE',      // PM중
  'MODEL_CHANGE',        // 모델교체
  'PLANNED_STOP',        // 계획정지
  'PROGRAM_CHANGE',      // 프로그램 교체
  'TOOL_CHANGE',         // 공구교환
  'TEMPORARY_STOP',      // 일시정지
] as const;

export type MachineState = typeof MACHINE_STATES[number];

/** 임의의 문자열이 유효한 설비 상태인지 검사하는 런타임 가드 */
export function isMachineState(value: unknown): value is MachineState {
  return typeof value === 'string' && (MACHINE_STATES as readonly string[]).includes(value);
}

// 설비에 연결된 생산 모델 (product_models 조인 결과)
export interface MachineProductModel {
  id: string;
  model_name: string;
  description?: string | null;
}

// 설비에 연결된 공정 (model_processes 조인 결과)
export interface MachineProcessInfo {
  id: string;
  process_name: string;
  process_order: number;
  tact_time_seconds: number;
  cavity_count?: number;
}

// 설비 정보 타입
//
// ⚠️ `machines` 테이블에는 다음 컬럼이 **존재하지 않는다**:
//    model_type / default_tact_time / processing_step / oee_efficiency
//    (실제 컬럼: id, name, location, equipment_type, is_active, current_state,
//     production_model_id, current_process_id, created_at, updated_at)
//    Tact time은 `current_tact_time`(뷰) 또는 `current_process.tact_time_seconds`(조인)에서 읽어야 한다.
export interface Machine {
  id: string;
  name: string;
  location: string;
  equipment_type?: string;           // 설비 타입 (선택사항)
  production_model_id?: string | null;  // 생산 모델 ID
  current_process_id?: string | null;   // 현재 공정 ID
  is_active: boolean;
  current_state?: MachineState;
  created_at?: string;               // DB nullable
  updated_at?: string;               // DB nullable

  // 조인된 정보들 (machines_with_production_info 뷰에서 가져올 때 — flat 형태)
  production_model_name?: string;
  production_model_description?: string;
  current_process_name?: string;
  current_process_order?: number;
  current_tact_time?: number;
  current_cavity_count?: number;

  // 조인된 정보들 (machines + 중첩 select 로 가져올 때 — 정규화된 nested 형태)
  // useMachines 가 아래 Supabase 기본 별칭을 unwrapJoin 으로 풀어 이 이름에 넣는다.
  production_model?: MachineProductModel | null;
  current_process?: MachineProcessInfo | null;

  // Supabase 기본 별칭 (`product_models(...)` / `model_processes(...)` 를 rename 없이 select 했을 때).
  // PostgREST 는 런타임에 객체를 주지만 생성된 타입은 배열이므로 Joined<> 로 둘 다 허용하고,
  // 읽을 때는 unwrapJoin() 으로 풀어 쓴다.
  product_models?: Joined<MachineProductModel>;
  model_processes?: Joined<MachineProcessInfo>;
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

// 다운타임 차트 데이터 (단일 정의 — DowntimeChart / useEngineerData 공용)
export interface DowntimeData {
  state: MachineState;
  duration: number;    // 분 단위
  count: number;       // 발생 횟수
  percentage: number;  // 전체 다운타임 대비 비율
}

// 생산 차트 데이터 (단일 정의 — ProductionChart / useEngineerData 공용)
//
// ⚠️ `good_qty` / `defect_rate` 는 DB 컬럼이 아니라 클라이언트 계산값이다.
//    (production_records 에는 output_qty, defect_qty 만 존재)
//    Supabase select 문에 good_qty 를 넣으면 런타임 에러가 난다.
export interface ProductionData {
  date: string;
  output_qty: number;
  defect_qty: number;
  good_qty: number;      // = output_qty - defect_qty (계산값)
  defect_rate: number;   // 계산값
  target_qty?: number;
  shift?: 'A' | 'B';     // DB 상 shift 값은 A / B 뿐이다
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
  t: (key: string, options?: Record<string, unknown>) => string;
}

// 에러 타입
export interface AppError {
  code: string;
  message: string;
  details?: unknown;
}

export enum ErrorCodes {
  AUTHENTICATION_FAILED = 'AUTH_001',
  UNAUTHORIZED_ACCESS = 'AUTH_002',
  MACHINE_NOT_FOUND = 'MACHINE_001',
  INVALID_STATE_TRANSITION = 'MACHINE_002',
  OEE_CALCULATION_ERROR = 'OEE_001',
  DATABASE_ERROR = 'DB_001'
}