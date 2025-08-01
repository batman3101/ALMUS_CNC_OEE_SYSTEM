export type UserRole = 'admin' | 'operator' | 'engineer';

export type MachineState = 
  | 'running'          // 정상가동
  | 'maintenance'      // 점검중
  | 'model_change'     // 모델교체
  | 'planned_stop'     // 계획정지
  | 'program_change'   // 프로그램 교체
  | 'tool_change'      // 공구교환
  | 'pause';           // 일시정지

export type Shift = 'A' | 'B';

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string;
          name: string;
          email: string;
          role: UserRole;
          assigned_machines: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          email: string;
          role: UserRole;
          assigned_machines?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          email?: string;
          role?: UserRole;
          assigned_machines?: string[] | null;
          updated_at?: string;
        };
      };
      machines: {
        Row: {
          id: string;
          name: string;
          location: string;
          model_type: string;
          default_tact_time: number; // in seconds
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          location: string;
          model_type: string;
          default_tact_time: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          location?: string;
          model_type?: string;
          default_tact_time?: number;
          is_active?: boolean;
          updated_at?: string;
        };
      };
      machine_logs: {
        Row: {
          id: string;
          machine_id: string;
          state: MachineState;
          start_time: string;
          end_time: string | null;
          duration: number | null; // in minutes
          operator_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          machine_id: string;
          state: MachineState;
          start_time: string;
          end_time?: string | null;
          duration?: number | null;
          operator_id: string;
          created_at?: string;
        };
        Update: {
          end_time?: string | null;
          duration?: number | null;
        };
      };
      production_records: {
        Row: {
          id: string;
          machine_id: string;
          date: string;
          shift: Shift;
          planned_runtime: number; // minutes
          actual_runtime: number; // minutes
          ideal_runtime: number; // minutes
          output_qty: number;
          defect_qty: number;
          availability: number;
          performance: number;
          quality: number;
          oee: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          machine_id: string;
          date: string;
          shift: Shift;
          planned_runtime: number;
          actual_runtime: number;
          ideal_runtime: number;
          output_qty: number;
          defect_qty: number;
          availability: number;
          performance: number;
          quality: number;
          oee: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          output_qty?: number;
          defect_qty?: number;
          availability?: number;
          performance?: number;
          quality?: number;
          oee?: number;
          updated_at?: string;
        };
      };
    };
    Views: {
      current_machine_status: {
        Row: {
          machine_id: string;
          machine_name: string;
          current_state: MachineState;
          state_start_time: string;
          state_duration: number;
          operator_name: string;
          today_oee: number | null;
          today_output: number | null;
          today_defects: number | null;
        };
      };
      daily_oee_summary: {
        Row: {
          machine_id: string;
          machine_name: string;
          date: string;
          availability: number;
          performance: number;
          quality: number;
          oee: number;
          total_output: number;
          total_defects: number;
        };
      };
    };
    Functions: {
      calculate_oee: {
        Args: {
          p_machine_id: string;
          p_start_time: string;
          p_end_time: string;
        };
        Returns: {
          availability: number;
          performance: number;
          quality: number;
          oee: number;
        };
      };
      update_machine_state: {
        Args: {
          p_machine_id: string;
          p_new_state: MachineState;
          p_operator_id: string;
        };
        Returns: void;
      };
    };
  };
}