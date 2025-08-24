export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      machines: {
        Row: {
          created_at: string | null
          current_state: Database["public"]["Enums"]["machine_status"]
          default_tact_time: number
          id: string
          is_active: boolean
          location: string | null
          model_type: string | null
          name: string
          processing_step: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_state?: Database["public"]["Enums"]["machine_status"]
          default_tact_time?: number
          id?: string
          is_active?: boolean
          location?: string | null
          model_type?: string | null
          name: string
          processing_step: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_state?: Database["public"]["Enums"]["machine_status"]
          default_tact_time?: number
          id?: string
          is_active?: boolean
          location?: string | null
          model_type?: string | null
          name?: string
          processing_step?: string
          updated_at?: string | null
        }
      }
      machine_status_descriptions: {
        Row: {
          color_code: string | null
          description_en: string | null
          description_ko: string
          description_vi: string | null
          display_order: number
          is_productive: boolean | null
          requires_reason: boolean | null
          status: Database["public"]["Enums"]["machine_status"]
        }
      }
      machine_status_history: {
        Row: {
          change_reason: string | null
          changed_by: string | null
          created_at: string | null
          duration_minutes: number | null
          id: string
          machine_id: string
          new_status: Database["public"]["Enums"]["machine_status"]
          previous_status: Database["public"]["Enums"]["machine_status"] | null
        }
      }
    }
    Enums: {
      machine_status:
        | "NORMAL_OPERATION"
        | "INSPECTION"
        | "BREAKDOWN_REPAIR"
        | "PM_MAINTENANCE"
        | "MODEL_CHANGE"
        | "PLANNED_STOP"
        | "PROGRAM_CHANGE"
        | "TOOL_CHANGE"
        | "TEMPORARY_STOP"
    }
  }
}

export type MachineStatus = Database["public"]["Enums"]["machine_status"];
export type Machine = Database["public"]["Tables"]["machines"]["Row"];
export type MachineStatusDescription = Database["public"]["Tables"]["machine_status_descriptions"]["Row"];
export type MachineStatusHistory = Database["public"]["Tables"]["machine_status_history"]["Row"];

// 상태 정보 맵핑
export const MACHINE_STATUS_INFO: Record<MachineStatus, {
  label_ko: string;
  label_vi: string;
  label_en: string;
  color: string;
  isProductive: boolean;
  requiresReason: boolean;
}> = {
  NORMAL_OPERATION: {
    label_ko: '정상가동',
    label_vi: 'Hoạt động bình thường',
    label_en: 'Normal Operation',
    color: '#52C41A',
    isProductive: true,
    requiresReason: false
  },
  INSPECTION: {
    label_ko: '점검중',
    label_vi: 'Đang kiểm tra',
    label_en: 'Under Inspection',
    color: '#1890FF',
    isProductive: false,
    requiresReason: true
  },
  BREAKDOWN_REPAIR: {
    label_ko: '고장수리중',
    label_vi: 'Đang sửa chữa',
    label_en: 'Breakdown Repair',
    color: '#FF4D4F',
    isProductive: false,
    requiresReason: true
  },
  PM_MAINTENANCE: {
    label_ko: 'PM중',
    label_vi: 'Bảo trì PM',
    label_en: 'PM Maintenance',
    color: '#FA8C16',
    isProductive: false,
    requiresReason: true
  },
  MODEL_CHANGE: {
    label_ko: '모델교체',
    label_vi: 'Thay đổi mẫu',
    label_en: 'Model Change',
    color: '#722ED1',
    isProductive: false,
    requiresReason: true
  },
  PLANNED_STOP: {
    label_ko: '계획정지',
    label_vi: 'Dừng theo kế hoạch',
    label_en: 'Planned Stop',
    color: '#8C8C8C',
    isProductive: false,
    requiresReason: false
  },
  PROGRAM_CHANGE: {
    label_ko: '프로그램 교체',
    label_vi: 'Thay đổi chương trình',
    label_en: 'Program Change',
    color: '#13C2C2',
    isProductive: false,
    requiresReason: true
  },
  TOOL_CHANGE: {
    label_ko: '공구교환',
    label_vi: 'Thay dụng cụ',
    label_en: 'Tool Change',
    color: '#EB2F96',
    isProductive: false,
    requiresReason: true
  },
  TEMPORARY_STOP: {
    label_ko: '일시정지',
    label_vi: 'Tạm dừng',
    label_en: 'Temporary Stop',
    color: '#FAAD14',
    isProductive: false,
    requiresReason: true
  }
};

// 상태 목록 (순서대로)
export const MACHINE_STATUS_LIST: MachineStatus[] = [
  'NORMAL_OPERATION',
  'INSPECTION',
  'BREAKDOWN_REPAIR',
  'PM_MAINTENANCE',
  'MODEL_CHANGE',
  'PLANNED_STOP',
  'PROGRAM_CHANGE',
  'TOOL_CHANGE',
  'TEMPORARY_STOP'
];

// 생산 가능 상태 필터
export const PRODUCTIVE_STATUSES = MACHINE_STATUS_LIST.filter(
  status => MACHINE_STATUS_INFO[status].isProductive
);

// 비생산 상태 필터
export const NON_PRODUCTIVE_STATUSES = MACHINE_STATUS_LIST.filter(
  status => !MACHINE_STATUS_INFO[status].isProductive
);

// 사유 입력이 필요한 상태 필터
export const REASON_REQUIRED_STATUSES = MACHINE_STATUS_LIST.filter(
  status => MACHINE_STATUS_INFO[status].requiresReason
);