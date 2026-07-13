export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// DB enum `machine_status` (MAINTENANCE 는 존재하지 않는다)
export type MachineStatus =
  | 'NORMAL_OPERATION'
  | 'INSPECTION'
  | 'BREAKDOWN_REPAIR'
  | 'PM_MAINTENANCE'
  | 'MODEL_CHANGE'
  | 'PLANNED_STOP'
  | 'PROGRAM_CHANGE'
  | 'TOOL_CHANGE'
  | 'TEMPORARY_STOP'

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          user_id: string
          name: string
          role: 'admin' | 'operator' | 'engineer'
          assigned_machines: string[] | null
          email: string | null
          is_active: boolean | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          name: string
          role: 'admin' | 'operator' | 'engineer'
          assigned_machines?: string[] | null
          email?: string | null
          is_active?: boolean | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          name?: string
          role?: 'admin' | 'operator' | 'engineer'
          assigned_machines?: string[] | null
          email?: string | null
          is_active?: boolean | null
          created_at?: string
          updated_at?: string
        }
      }
      // ⚠️ 실제 `machines` 테이블 컬럼과 일치시킨 정의.
      // 과거 이 타입에는 model_type / default_tact_time / processing_step 이 있었으나
      // DB 에 존재하지 않는 컬럼이었다. (2026-07 라이브 스키마 기준으로 정정)
      machines: {
        Row: {
          id: string
          name: string
          location: string | null
          equipment_type: string | null
          is_active: boolean
          current_state: MachineStatus
          production_model_id: string | null
          current_process_id: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          location?: string | null
          equipment_type?: string | null
          is_active?: boolean
          current_state?: MachineStatus
          production_model_id?: string | null
          current_process_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          location?: string | null
          equipment_type?: string | null
          is_active?: boolean
          current_state?: MachineStatus
          production_model_id?: string | null
          current_process_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      machine_logs: {
        Row: {
          log_id: string
          machine_id: string
          state: 'NORMAL_OPERATION' | 'INSPECTION' | 'BREAKDOWN_REPAIR' | 'PM_MAINTENANCE' | 'MODEL_CHANGE' | 'PLANNED_STOP' | 'PROGRAM_CHANGE' | 'TOOL_CHANGE' | 'TEMPORARY_STOP'
          start_time: string
          end_time: string | null
          duration: number | null
          operator_id: string | null
          created_at: string
        }
        Insert: {
          log_id?: string
          machine_id: string
          state: 'NORMAL_OPERATION' | 'INSPECTION' | 'BREAKDOWN_REPAIR' | 'PM_MAINTENANCE' | 'MODEL_CHANGE' | 'PLANNED_STOP' | 'PROGRAM_CHANGE' | 'TOOL_CHANGE' | 'TEMPORARY_STOP'
          start_time: string
          end_time?: string | null
          duration?: number | null
          operator_id?: string | null
          created_at?: string
        }
        Update: {
          log_id?: string
          machine_id?: string
          state?: 'NORMAL_OPERATION' | 'INSPECTION' | 'BREAKDOWN_REPAIR' | 'PM_MAINTENANCE' | 'MODEL_CHANGE' | 'PLANNED_STOP' | 'PROGRAM_CHANGE' | 'TOOL_CHANGE' | 'TEMPORARY_STOP'
          start_time?: string
          end_time?: string | null
          duration?: number | null
          operator_id?: string | null
          created_at?: string
        }
      }
      production_records: {
        Row: {
          record_id: string
          machine_id: string
          date: string
          shift: 'A' | 'B' | null
          planned_runtime: number | null
          actual_runtime: number | null
          ideal_runtime: number | null
          output_qty: number
          defect_qty: number
          availability: number | null
          performance: number | null
          quality: number | null
          oee: number | null
          created_at: string
        }
        Insert: {
          record_id?: string
          machine_id: string
          date: string
          shift?: 'A' | 'B' | null
          planned_runtime?: number | null
          actual_runtime?: number | null
          ideal_runtime?: number | null
          output_qty?: number
          defect_qty?: number
          availability?: number | null
          performance?: number | null
          quality?: number | null
          oee?: number | null
          created_at?: string
        }
        Update: {
          record_id?: string
          machine_id?: string
          date?: string
          shift?: 'A' | 'B' | null
          planned_runtime?: number | null
          actual_runtime?: number | null
          ideal_runtime?: number | null
          output_qty?: number
          defect_qty?: number
          availability?: number | null
          performance?: number | null
          quality?: number | null
          oee?: number | null
          created_at?: string
        }
      }
      audit_log: {
        Row: {
          id: string
          table_name: string
          record_id: string
          action: string
          old_values: Json | null
          new_values: Json | null
          changed_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          table_name: string
          record_id: string
          action: string
          old_values?: Json | null
          new_values?: Json | null
          changed_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          table_name?: string
          record_id?: string
          action?: string
          old_values?: Json | null
          new_values?: Json | null
          changed_by?: string | null
          created_at?: string | null
        }
      }
      system_settings: {
        Row: {
          id: string
          setting_key: string
          setting_value: Json
          default_value: Json
          description: string | null
          category: string
          data_type: string
          validation_rules: Json | null
          is_active: boolean | null
          is_system: boolean | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          setting_key: string
          setting_value: Json
          default_value: Json
          description?: string | null
          category?: string
          data_type?: string
          validation_rules?: Json | null
          is_active?: boolean | null
          is_system?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          setting_key?: string
          setting_value?: Json
          default_value?: Json
          description?: string | null
          category?: string
          data_type?: string
          validation_rules?: Json | null
          is_active?: boolean | null
          is_system?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          updated_by?: string | null
        }
      }
      oee_calculations: {
        Row: {
          id: string
          machine_id: string | null
          calculation_date: string
          availability: number | null
          performance: number | null
          quality: number | null
          oee: number | null
          created_at: string | null
        }
        Insert: {
          id?: string
          machine_id?: string | null
          calculation_date: string
          availability?: number | null
          performance?: number | null
          quality?: number | null
          oee?: number | null
          created_at?: string | null
        }
        Update: {
          id?: string
          machine_id?: string | null
          calculation_date?: string
          availability?: number | null
          performance?: number | null
          quality?: number | null
          oee?: number | null
          created_at?: string | null
        }
      }
      product_models: {
        Row: {
          id: string
          model_name: string
          description: string | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          model_name: string
          description?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          model_name?: string
          description?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      model_processes: {
        Row: {
          id: string
          model_id: string
          process_name: string
          process_order: number
          tact_time_seconds: number
          cavity_count: number
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          model_id: string
          process_name: string
          process_order: number
          tact_time_seconds?: number
          cavity_count?: number
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          model_id?: string
          process_name?: string
          process_order?: number
          tact_time_seconds?: number
          cavity_count?: number
          created_at?: string | null
          updated_at?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}