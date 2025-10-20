// 보고서 관련 타입 정의

export interface ReportFilter {
  startDate: string;
  endDate: string;
  machineIds?: string[];
  shifts?: ('A' | 'B')[];
  includeInactive?: boolean;
}

export interface ReportPeriod {
  type: 'daily' | 'weekly' | 'monthly' | 'custom';
  startDate: string;
  endDate: string;
}

export interface MachineReportData {
  machine_id: string;
  machine_name: string;
  location: string;
  model_type: string;
  total_records: number;
  avg_oee: number;
  avg_availability: number;
  avg_performance: number;
  avg_quality: number;
  total_output: number;
  total_defects: number;
  total_runtime: number;
  total_planned_runtime: number;
  downtime_minutes: number;
  shift_data: ShiftReportData[];
}

export interface ShiftReportData {
  shift: 'A' | 'B';
  date: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  output_qty: number;
  defect_qty: number;
  actual_runtime: number;
  planned_runtime: number;
  downtime_reasons: DowntimeReason[];
}

export interface DowntimeReason {
  state: string;
  duration_minutes: number;
  percentage: number;
}

export interface OEEComparisonData {
  machine_id: string;
  machine_name: string;
  current_period: OEEMetrics;
  previous_period: OEEMetrics;
  improvement: {
    oee_change: number;
    availability_change: number;
    performance_change: number;
    quality_change: number;
  };
}

export interface ReportSummary {
  period: ReportPeriod;
  total_machines: number;
  active_machines: number;
  overall_oee: number;
  overall_availability: number;
  overall_performance: number;
  overall_quality: number;
  total_output: number;
  total_defects: number;
  total_downtime_hours: number;
  best_performing_machine: {
    machine_id: string;
    machine_name: string;
    oee: number;
  };
  worst_performing_machine: {
    machine_id: string;
    machine_name: string;
    oee: number;
  };
  top_downtime_reasons: DowntimeReason[];
}

export interface DetailedReport {
  summary: ReportSummary;
  machine_data: MachineReportData[];
  comparison_data: OEEComparisonData[];
  trend_data: TrendData[];
}

export interface TrendData {
  date: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  output: number;
  defects: number;
}

export interface ReportExportOptions {
  format: 'pdf' | 'excel';
  includeCharts: boolean;
  includeSummary: boolean;
  includeMachineDetails: boolean;
  includeComparison: boolean;
  includeTrends: boolean;
}

// OEE 지표를 다시 export (기존 타입과 호환성 유지)
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