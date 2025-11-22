// 데이터 입력 관련 타입 정의

export interface MachineDataInput {
  // 기본 정보
  machine_id: string; // machine_name -> machine_id로 변경
  
  // 새로운 모델/공정 정보
  model_id?: string;
  process_id?: string;
  
  // 생산 정보
  tact_time: number; // 초 단위
  daily_operating_hours: number; // 시간 단위
  daily_capacity?: number; // 자동 계산됨
  
  // 실적 정보
  actual_production: number;
  defect_quantity: number;
  
  // 비가동 정보
  downtime_minutes: number;
  
  // 메타 정보
  input_date: string;
  shift: 'DAY' | 'NIGHT';
  operator_id?: string;
  operator_name?: string;
}

// 교대별 생산 데이터
export interface ShiftProductionData {
  shift: 'DAY' | 'NIGHT';
  shift_name: string; // '주간조' | '야간조'
  start_time: string; // '08:00'
  end_time: string; // '20:00'
  operator_name: string;
  
  // 생산 실적
  actual_production: number;
  defect_quantity: number;
  good_quantity: number; // actual - defect
  
  // 비가동 시간
  downtime_entries: DowntimeEntry[];
  total_downtime_minutes: number;
}

export interface DowntimeEntry {
  id?: string;
  machine_id: string;
  date?: string; // YYYY-MM-DD format
  shift?: 'A' | 'B'; // A: Day shift (08:00-20:00), B: Night shift (20:00-08:00)
  start_time: string;
  end_time?: string;
  duration_minutes?: number;
  reason: string;
  description?: string;
  operator_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ProductionEntry {
  id?: string;
  machine_id: string;
  date: string;
  shift: 'DAY' | 'NIGHT';
  planned_production: number;
  actual_production: number;
  defect_quantity: number;
  good_quantity?: number; // actual_production - defect_quantity
  operator_id?: string;
  operator_name?: string;
  created_at?: string;
}

// 일일 생산 데이터 (주간조 + 야간조 합산)
export interface DailyProductionData {
  machine_id: string;
  date: string;
  
  // 주간조 데이터
  day_shift: ShiftProductionData;
  
  // 야간조 데이터  
  night_shift: ShiftProductionData;
  
  // 일일 합계
  total_production: number;
  total_defects: number;
  total_good_quantity: number;
  total_downtime_minutes: number;
  
  // OEE 계산 (모델 무관)
  planned_capacity: number; // 일일 계획 생산량
  availability: number; // 가용성
  performance: number; // 성능
  quality: number; // 품질
  oee: number; // 종합효율
}

export interface MachineProcess {
  id?: string;
  machine_id: string;
  process_order: number;
  process_name: string;
  description?: string;
  standard_time?: number; // 표준 시간 (초)
  created_at?: string;
  updated_at?: string;
}

export interface MachineConfiguration {
  id?: string;
  machine_id: string;
  tact_time: number;
  daily_operating_hours: number;
  daily_capacity: number;
  effective_date: string;
  created_at?: string;
  updated_at?: string;
}

// 비가동 사유 키 (번역용)
export const DOWNTIME_REASON_KEYS = [
  'equipmentFailure',
  'endmillChange',
  'materialShortage',
  'qualityDefect',
  'plannedStop',
  'productionModelChange',
  'pm',
  'programChange',
  'other'
] as const;

export type DowntimeReasonKey = typeof DOWNTIME_REASON_KEYS[number];

// 비가동 사유 enum (Deprecated: 하위 호환성을 위해 유지)
export const DOWNTIME_REASONS = [
  '설비 고장',
  'ENDMILL 교체',
  '자재 부족',
  '품질 불량',
  '계획 정지',
  '생산모델 교체',
  'PM',
  '기타'
] as const;

export type DowntimeReason = typeof DOWNTIME_REASONS[number];

// 데이터 입력 폼 상태
export interface DataInputFormState {
  machine: MachineDataInput;
  processes: MachineProcess[];
  downtimes: DowntimeEntry[];
  production: ProductionEntry;
  isLoading: boolean;
  errors: Record<string, string>;
}

// API 응답 타입
export interface DataInputResponse {
  success: boolean;
  data?: any;
  error?: string;
}

// 엑셀 업로드 템플릿 타입
export interface ExcelMachineTemplate {
  '설비명': string;
  '설비번호': string;
  '모델': string;
  '공정1': string;
  '공정2'?: string;
  '공정3'?: string;
  '공정4'?: string;
  'Tact Time(초)': number;
  '일일 가동시간(시간)': number;
  '위치': string;
  '비고'?: string;
}