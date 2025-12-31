// 알림 관련 타입 정의

export type NotificationType = 
  | 'OEE_LOW'           // OEE 저하
  | 'DOWNTIME_EXCEEDED' // 다운타임 초과
  | 'MACHINE_STOPPED'   // 설비 정지
  | 'QUALITY_ISSUE'     // 품질 문제
  | 'MAINTENANCE_DUE';  // 점검 필요

export type NotificationSeverity = 'low' | 'medium' | 'high' | 'critical';

export type NotificationStatus = 'active' | 'acknowledged' | 'resolved';

// 알림 데이터 인터페이스
export interface Notification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  status: NotificationStatus;
  machine_id: string;
  machine_name: string;
  title: string;
  message: string;
  threshold_value?: number;
  current_value?: number;
  created_at: string;
  acknowledged_at?: string;
  acknowledged_by?: string;
  resolved_at?: string;
  metadata?: Record<string, unknown>;
}

// 알림 임계치 설정 인터페이스
export interface NotificationThreshold {
  id: string;
  type: NotificationType;
  machine_id?: string; // null이면 전체 설비에 적용
  threshold_value: number;
  duration_minutes?: number; // 지속 시간 (분)
  is_enabled: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// 알림 규칙 인터페이스
export interface NotificationRule {
  id: string;
  name: string;
  type: NotificationType;
  condition: string; // JSON 형태의 조건
  threshold_value: number;
  duration_minutes: number;
  severity: NotificationSeverity;
  is_enabled: boolean;
  machine_ids?: string[]; // 적용할 설비 목록
  user_roles?: string[]; // 알림을 받을 사용자 역할
  created_by: string;
  created_at: string;
  updated_at: string;
}

// 알림 설정 인터페이스
export interface NotificationSettings {
  user_id: string;
  email_enabled: boolean;
  push_enabled: boolean;
  sound_enabled: boolean;
  notification_types: NotificationType[];
  quiet_hours_start?: string; // HH:MM 형식
  quiet_hours_end?: string; // HH:MM 형식
  updated_at: string;
}

// 알림 컨텍스트 타입
export interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: Omit<Notification, 'id' | 'created_at'>) => void;
  acknowledgeNotification: (id: string) => Promise<void>;
  resolveNotification: (id: string) => Promise<void>;
  clearNotification: (id: string) => Promise<void>;
  clearAllNotifications: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

// 알림 감지 결과 인터페이스
export interface NotificationDetectionResult {
  shouldNotify: boolean;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  threshold_value?: number;
  current_value?: number;
  metadata?: Record<string, unknown>;
}

// 알림 필터 옵션
export interface NotificationFilter {
  types?: NotificationType[];
  severities?: NotificationSeverity[];
  statuses?: NotificationStatus[];
  machine_ids?: string[];
  date_from?: string;
  date_to?: string;
}

// Toast 알림 옵션
export interface ToastNotificationOptions {
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  duration?: number; // 밀리초
  action?: {
    label: string;
    onClick: () => void;
  };
}