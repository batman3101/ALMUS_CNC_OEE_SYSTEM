// 데이터 입력 관련 타입 정의

export interface MachineDataInput {
  // 기본 정보
  machine_name: string;
  machine_number: string;
  model_type?: string; // Legacy field, kept for backward compatibility
  
  // 새로운 모델/공정 정보
  model_id?: string;
  process_id?: string;
  
  // 공정 정보 (Legacy)
  process_1?: string;
  process_2?: string;
  process_3?: string;
  process_4?: string;
  
  // 생산 정보
  tact_time: number; // 초 단위
  daily_operating_hours: number; // 시간 단위
  daily_capacity?: number; // 자동 계산됨
  
  // 실적 정보
  actual_production: number;
  defect_quantity: number;
  
  // 비가동 정보
  downtime_minutes: number;
  downtime_reason: string;
  
  // 메타 정보
  input_date: string;
  shift: 'A' | 'B';
  operator_id?: string;
}

export interface DowntimeEntry {
  id?: string;
  machine_id: string;
  start_time: string;
  end_time?: string;
  duration_minutes?: number;
  reason: string;
  description?: string;
  operator_id?: string;
  created_at?: string;
}

export interface ProductionEntry {
  id?: string;
  machine_id: string;
  date: string;
  shift: 'A' | 'B';
  planned_production: number;
  actual_production: number;
  defect_quantity: number;
  good_quantity?: number; // actual_production - defect_quantity
  operator_id?: string;
  created_at?: string;
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

// 비가동 사유 enum
export const DOWNTIME_REASONS = [
  '설비 고장',
  '금형 교체',
  '자재 부족',
  '품질 불량',
  '계획 정지',
  '청소/정리',
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