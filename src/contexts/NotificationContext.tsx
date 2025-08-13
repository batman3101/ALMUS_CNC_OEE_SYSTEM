'use client';

import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { 
  Notification, 
  NotificationContextType, 
  NotificationType,
  NotificationSeverity 
} from '@/types/notifications';
import { useAuth } from './AuthContext';
import { showToast } from '@/components/notifications';
import { useLanguage } from './LanguageContext';

// 알림 상태 관리를 위한 리듀서
interface NotificationState {
  notifications: Notification[];
  loading: boolean;
  error: string | null;
}

type NotificationAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_NOTIFICATIONS'; payload: Notification[] }
  | { type: 'ADD_NOTIFICATION'; payload: Notification }
  | { type: 'UPDATE_NOTIFICATION'; payload: { id: string; updates: Partial<Notification> } }
  | { type: 'REMOVE_NOTIFICATION'; payload: string }
  | { type: 'CLEAR_ALL_NOTIFICATIONS' };

const initialState: NotificationState = {
  notifications: [],
  loading: false,
  error: null,
};

const notificationReducer = (state: NotificationState, action: NotificationAction): NotificationState => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_NOTIFICATIONS':
      return { ...state, notifications: action.payload };
    case 'ADD_NOTIFICATION':
      return { 
        ...state, 
        notifications: [action.payload, ...state.notifications] 
      };
    case 'UPDATE_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.map(notification =>
          notification.id === action.payload.id
            ? { ...notification, ...action.payload.updates }
            : notification
        )
      };
    case 'REMOVE_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.filter(n => n.id !== action.payload)
      };
    case 'CLEAR_ALL_NOTIFICATIONS':
      return { ...state, notifications: [] };
    default:
      return state;
  }
};

// 알림 컨텍스트 생성
const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// 알림 컨텍스트 프로바이더
interface NotificationProviderProps {
  children: React.ReactNode;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(notificationReducer, initialState);
  const { user } = useAuth();
  const { t } = useLanguage();

  // 모의 알림 데이터 생성 (실제로는 Supabase에서 가져옴)
  const generateMockNotifications = useCallback((): Notification[] => {
    const mockNotifications: Notification[] = [
      {
        id: '1',
        type: 'OEE_LOW',
        severity: 'high',
        status: 'active',
        machine_id: 'cnc-004',
        machine_name: 'CNC-004',
        title: 'OEE 저하 경고',
        message: 'OEE가 60% 미만으로 30분 이상 지속되고 있습니다.',
        threshold_value: 60,
        current_value: 45,
        created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      },
      {
        id: '2',
        type: 'DOWNTIME_EXCEEDED',
        severity: 'medium',
        status: 'active',
        machine_id: 'cnc-002',
        machine_name: 'CNC-002',
        title: '다운타임 초과',
        message: '점검 시간이 예상 시간을 초과했습니다.',
        threshold_value: 60,
        current_value: 85,
        created_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
      },
      {
        id: '3',
        type: 'QUALITY_ISSUE',
        severity: 'medium',
        status: 'acknowledged',
        machine_id: 'cnc-007',
        machine_name: 'CNC-007',
        title: '품질 문제 발생',
        message: '불량률이 임계치를 초과했습니다.',
        threshold_value: 5,
        current_value: 7.2,
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        acknowledged_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        acknowledged_by: user?.id,
      },
      {
        id: '4',
        type: 'MACHINE_STOPPED',
        severity: 'critical',
        status: 'resolved',
        machine_id: 'cnc-001',
        machine_name: 'CNC-001',
        title: '설비 긴급 정지',
        message: '안전 센서 작동으로 설비가 긴급 정지되었습니다.',
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        resolved_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }
    ];

    return mockNotifications;
  }, [user?.id]);

  // 알림 목록 새로고침
  const refreshNotifications = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      // 실제로는 Supabase에서 알림을 가져옴
      // const { data, error } = await supabase
      //   .from('notifications')
      //   .select('*')
      //   .order('created_at', { ascending: false });
      
      const mockNotifications = generateMockNotifications();
      dispatch({ type: 'SET_NOTIFICATIONS', payload: mockNotifications });
      dispatch({ type: 'SET_ERROR', payload: null });
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to fetch notifications' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [generateMockNotifications]);

  // 알림 추가
  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'created_at'>) => {
    const newNotification: Notification = {
      ...notification,
      id: Date.now().toString(),
      created_at: new Date().toISOString(),
    };

    dispatch({ type: 'ADD_NOTIFICATION', payload: newNotification });

    // Toast 알림 표시
    const toastTitle = notification.title;
    const toastMessage = `${notification.machine_name}: ${notification.message}`;
    
    switch (notification.severity) {
      case 'critical':
        showToast({ type: 'error', title: toastTitle, message: toastMessage });
        break;
      case 'high':
      case 'medium':
        showToast({ type: 'warning', title: toastTitle, message: toastMessage });
        break;
      case 'low':
        showToast({ type: 'info', title: toastTitle, message: toastMessage });
        break;
    }
  }, []);

  // 알림 확인 처리
  const acknowledgeNotification = useCallback(async (id: string) => {
    try {
      // 실제로는 Supabase 업데이트
      // await supabase
      //   .from('notifications')
      //   .update({ 
      //     status: 'acknowledged',
      //     acknowledged_at: new Date().toISOString(),
      //     acknowledged_by: user?.id
      //   })
      //   .eq('id', id);

      dispatch({ 
        type: 'UPDATE_NOTIFICATION', 
        payload: { 
          id, 
          updates: { 
            status: 'acknowledged',
            acknowledged_at: new Date().toISOString(),
            acknowledged_by: user?.id
          } 
        } 
      });

      showToast({ 
        type: 'success', 
        title: t('notifications.acknowledged'), 
        message: t('notifications.acknowledgedMessage') 
      });
    } catch (error) {
      console.error('Failed to acknowledge notification:', error);
      showToast({ 
        type: 'error', 
        title: t('common.error'), 
        message: t('notifications.acknowledgeError') 
      });
    }
  }, [user?.id, t]);

  // 알림 해결 처리
  const resolveNotification = useCallback(async (id: string) => {
    try {
      // 실제로는 Supabase 업데이트
      dispatch({ 
        type: 'UPDATE_NOTIFICATION', 
        payload: { 
          id, 
          updates: { 
            status: 'resolved',
            resolved_at: new Date().toISOString()
          } 
        } 
      });

      showToast({ 
        type: 'success', 
        title: t('notifications.resolved'), 
        message: t('notifications.resolvedMessage') 
      });
    } catch (error) {
      console.error('Failed to resolve notification:', error);
      showToast({ 
        type: 'error', 
        title: t('common.error'), 
        message: t('notifications.resolveError') 
      });
    }
  }, [t]);

  // 알림 삭제
  const clearNotification = useCallback(async (id: string) => {
    try {
      // 실제로는 Supabase에서 삭제
      dispatch({ type: 'REMOVE_NOTIFICATION', payload: id });
      
      showToast({ 
        type: 'success', 
        title: t('notifications.deleted'), 
        message: t('notifications.deletedMessage') 
      });
    } catch (error) {
      console.error('Failed to delete notification:', error);
      showToast({ 
        type: 'error', 
        title: t('common.error'), 
        message: t('notifications.deleteError') 
      });
    }
  }, [t]);

  // 모든 알림 삭제
  const clearAllNotifications = useCallback(async () => {
    try {
      // 실제로는 Supabase에서 모든 알림 삭제
      dispatch({ type: 'CLEAR_ALL_NOTIFICATIONS' });
      
      showToast({ 
        type: 'success', 
        title: t('notifications.allCleared'), 
        message: t('notifications.allClearedMessage') 
      });
    } catch (error) {
      console.error('Failed to clear all notifications:', error);
      showToast({ 
        type: 'error', 
        title: t('common.error'), 
        message: t('notifications.clearAllError') 
      });
    }
  }, [t]);

  // 읽지 않은 알림 수 계산
  const unreadCount = state.notifications.filter(n => n.status === 'active').length;

  // 초기 데이터 로드
  useEffect(() => {
    if (user) {
      refreshNotifications();
    }
  }, [user, refreshNotifications]);

  const contextValue: NotificationContextType = {
    notifications: state.notifications,
    unreadCount,
    addNotification,
    acknowledgeNotification,
    resolveNotification,
    clearNotification,
    clearAllNotifications,
    refreshNotifications,
  };

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
};

// 알림 컨텍스트 훅
export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};