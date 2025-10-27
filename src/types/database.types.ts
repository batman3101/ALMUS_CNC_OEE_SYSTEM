export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          changed_by: string | null
          created_at: string | null
          id: string
          new_values: Json | null
          old_values: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          changed_by?: string | null
          created_at?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          changed_by?: string | null
          created_at?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      machine_logs: {
        Row: {
          created_at: string | null
          duration: number | null
          end_time: string | null
          log_id: string
          machine_id: string
          operator_id: string | null
          start_time: string
          state: string
        }
        Insert: {
          created_at?: string | null
          duration?: number | null
          end_time?: string | null
          log_id?: string
          machine_id: string
          operator_id?: string | null
          start_time?: string
          state: string
        }
        Update: {
          created_at?: string | null
          duration?: number | null
          end_time?: string | null
          log_id?: string
          machine_id?: string
          operator_id?: string | null
          start_time?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "machine_logs_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "current_machine_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_logs_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_logs_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines_with_production_info"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_logs_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
        ]
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
        Insert: {
          color_code?: string | null
          description_en?: string | null
          description_ko: string
          description_vi?: string | null
          display_order: number
          is_productive?: boolean | null
          requires_reason?: boolean | null
          status: Database["public"]["Enums"]["machine_status"]
        }
        Update: {
          color_code?: string | null
          description_en?: string | null
          description_ko?: string
          description_vi?: string | null
          display_order?: number
          is_productive?: boolean | null
          requires_reason?: boolean | null
          status?: Database["public"]["Enums"]["machine_status"]
        }
        Relationships: []
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
        Insert: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          id?: string
          machine_id: string
          new_status: Database["public"]["Enums"]["machine_status"]
          previous_status?: Database["public"]["Enums"]["machine_status"] | null
        }
        Update: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          id?: string
          machine_id?: string
          new_status?: Database["public"]["Enums"]["machine_status"]
          previous_status?: Database["public"]["Enums"]["machine_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "machine_status_history_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "current_machine_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_status_history_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_status_history_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines_with_production_info"
            referencedColumns: ["id"]
          },
        ]
      }
      machines: {
        Row: {
          created_at: string | null
          current_process_id: string | null
          current_state: Database["public"]["Enums"]["machine_status"]
          equipment_type: string | null
          id: string
          is_active: boolean
          location: string | null
          name: string
          production_model_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_process_id?: string | null
          current_state?: Database["public"]["Enums"]["machine_status"]
          equipment_type?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          name: string
          production_model_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_process_id?: string | null
          current_state?: Database["public"]["Enums"]["machine_status"]
          equipment_type?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          name?: string
          production_model_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "machines_current_process_id_fkey"
            columns: ["current_process_id"]
            isOneToOne: false
            referencedRelation: "model_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machines_production_model_id_fkey"
            columns: ["production_model_id"]
            isOneToOne: false
            referencedRelation: "product_models"
            referencedColumns: ["id"]
          },
        ]
      }
      model_processes: {
        Row: {
          cavity_count: number
          created_at: string | null
          id: string
          model_id: string
          process_name: string
          process_order: number
          tact_time_seconds: number
          updated_at: string | null
        }
        Insert: {
          cavity_count?: number
          created_at?: string | null
          id?: string
          model_id: string
          process_name: string
          process_order: number
          tact_time_seconds?: number
          updated_at?: string | null
        }
        Update: {
          cavity_count?: number
          created_at?: string | null
          id?: string
          model_id?: string
          process_name?: string
          process_order?: number
          tact_time_seconds?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "model_processes_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "product_models"
            referencedColumns: ["id"]
          },
        ]
      }
      oee_calculations: {
        Row: {
          availability: number | null
          calculation_date: string
          created_at: string | null
          id: string
          machine_id: string | null
          oee: number | null
          performance: number | null
          quality: number | null
        }
        Insert: {
          availability?: number | null
          calculation_date: string
          created_at?: string | null
          id?: string
          machine_id?: string | null
          oee?: number | null
          performance?: number | null
          quality?: number | null
        }
        Update: {
          availability?: number | null
          calculation_date?: string
          created_at?: string | null
          id?: string
          machine_id?: string | null
          oee?: number | null
          performance?: number | null
          quality?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_oee_calculations_machine_id"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "current_machine_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_oee_calculations_machine_id"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_oee_calculations_machine_id"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines_with_production_info"
            referencedColumns: ["id"]
          },
        ]
      }
      product_models: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          model_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          model_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          model_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      production_records: {
        Row: {
          actual_runtime: number | null
          availability: number | null
          created_at: string | null
          date: string
          defect_qty: number
          ideal_runtime: number | null
          machine_id: string
          oee: number | null
          output_qty: number
          performance: number | null
          planned_runtime: number | null
          quality: number | null
          record_id: string
          shift: string | null
        }
        Insert: {
          actual_runtime?: number | null
          availability?: number | null
          created_at?: string | null
          date: string
          defect_qty?: number
          ideal_runtime?: number | null
          machine_id: string
          oee?: number | null
          output_qty?: number
          performance?: number | null
          planned_runtime?: number | null
          quality?: number | null
          record_id?: string
          shift?: string | null
        }
        Update: {
          actual_runtime?: number | null
          availability?: number | null
          created_at?: string | null
          date?: string
          defect_qty?: number
          ideal_runtime?: number | null
          machine_id?: string
          oee?: number | null
          output_qty?: number
          performance?: number | null
          planned_runtime?: number | null
          quality?: number | null
          record_id?: string
          shift?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_records_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "current_machine_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_records_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_records_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines_with_production_info"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          category: string
          created_at: string | null
          created_by: string | null
          data_type: string
          default_value: Json
          description: string | null
          id: string
          is_active: boolean | null
          is_system: boolean | null
          setting_key: string
          setting_value: Json
          updated_at: string | null
          updated_by: string | null
          validation_rules: Json | null
        }
        Insert: {
          category?: string
          created_at?: string | null
          created_by?: string | null
          data_type?: string
          default_value: Json
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          setting_key: string
          setting_value: Json
          updated_at?: string | null
          updated_by?: string | null
          validation_rules?: Json | null
        }
        Update: {
          category?: string
          created_at?: string | null
          created_by?: string | null
          data_type?: string
          default_value?: Json
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          setting_key?: string
          setting_value?: Json
          updated_at?: string | null
          updated_by?: string | null
          validation_rules?: Json | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          assigned_machines: string[] | null
          created_at: string | null
          email: string | null
          is_active: boolean | null
          name: string
          role: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          assigned_machines?: string[] | null
          created_at?: string | null
          email?: string | null
          is_active?: boolean | null
          name: string
          role: string
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          assigned_machines?: string[] | null
          created_at?: string | null
          email?: string | null
          is_active?: boolean | null
          name?: string
          role?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      current_machine_status: {
        Row: {
          current_state: string | null
          id: string | null
          is_active: boolean | null
          location: string | null
          model_type: string | null
          name: string | null
          state_start_time: string | null
        }
        Insert: {
          current_state?: never
          id?: string | null
          is_active?: boolean | null
          location?: string | null
          model_type?: string | null
          name?: string | null
          state_start_time?: never
        }
        Update: {
          current_state?: never
          id?: string | null
          is_active?: boolean | null
          location?: string | null
          model_type?: string | null
          name?: string | null
          state_start_time?: never
        }
        Relationships: []
      }
      latest_oee_metrics: {
        Row: {
          actual_runtime: number | null
          availability: number | null
          created_at: string | null
          date: string | null
          defect_qty: number | null
          ideal_runtime: number | null
          location: string | null
          machine_id: string | null
          machine_name: string | null
          oee: number | null
          output_qty: number | null
          performance: number | null
          planned_runtime: number | null
          quality: number | null
          record_id: string | null
          shift: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_records_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "current_machine_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_records_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_records_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines_with_production_info"
            referencedColumns: ["id"]
          },
        ]
      }
      machine_status_statistics: {
        Row: {
          color_code: string | null
          current_state: Database["public"]["Enums"]["machine_status"] | null
          description_en: string | null
          description_ko: string | null
          description_vi: string | null
          display_order: number | null
          is_productive: boolean | null
          machine_count: number | null
          percentage: number | null
        }
        Relationships: []
      }
      machines_with_production_info: {
        Row: {
          created_at: string | null
          current_cavity_count: number | null
          current_process_id: string | null
          current_process_name: string | null
          current_process_order: number | null
          current_state: Database["public"]["Enums"]["machine_status"] | null
          current_tact_time: number | null
          equipment_type: string | null
          id: string | null
          is_active: boolean | null
          location: string | null
          name: string | null
          production_model_description: string | null
          production_model_id: string | null
          production_model_name: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "machines_current_process_id_fkey"
            columns: ["current_process_id"]
            isOneToOne: false
            referencedRelation: "model_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machines_production_model_id_fkey"
            columns: ["production_model_id"]
            isOneToOne: false
            referencedRelation: "product_models"
            referencedColumns: ["id"]
          },
        ]
      }
      recent_machine_status_changes: {
        Row: {
          change_reason: string | null
          changed_by_name: string | null
          created_at: string | null
          duration_minutes: number | null
          id: string | null
          machine_id: string | null
          machine_name: string | null
          new_status: Database["public"]["Enums"]["machine_status"] | null
          new_status_ko: string | null
          previous_status: Database["public"]["Enums"]["machine_status"] | null
          previous_status_ko: string | null
        }
        Relationships: [
          {
            foreignKeyName: "machine_status_history_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "current_machine_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_status_history_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_status_history_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "machines_with_production_info"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles_rls_debug: {
        Row: {
          check_type: string | null
          value: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_system_setting: {
        Args: { p_category: string; p_key: string }
        Returns: Json
      }
      update_system_setting: {
        Args: {
          p_category: string
          p_key: string
          p_reason?: string
          p_value: string
        }
        Returns: Json
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
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      machine_status: [
        "NORMAL_OPERATION",
        "INSPECTION",
        "BREAKDOWN_REPAIR",
        "PM_MAINTENANCE",
        "MODEL_CHANGE",
        "PLANNED_STOP",
        "PROGRAM_CHANGE",
        "TOOL_CHANGE",
        "TEMPORARY_STOP",
      ],
    },
  },
} as const
