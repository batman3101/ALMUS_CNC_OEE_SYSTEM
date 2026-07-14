'use client';

import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo } from 'react';
import {
  Notification,
  NotificationContextType,
  NotificationSeverity
} from '@/types/notifications';
import type { Machine, MachineState } from '@/types';
import { useAuth } from './AuthContext';
import { showToast } from '@/components/notifications';
import { useLanguage } from './LanguageContext';
import { fetchMachines } from '@/lib/machinesCache';

/**
 * 비정상 설비 상태별 심각도.
 * 여기에 있는 상태는 notifications.machineState.<상태> 번역 키를 그대로 갖는다
 * (public/locales/{ko,vi}/common.json). 목록에 없는 상태는 'unknown' 문구로 처리한다.
 */
const STATE_SEVERITY: Partial<Record<MachineState, NotificationSeverity>> = {
  TEMPORARY_STOP: 'high',
  INSPECTION: 'low',
  PM_MAINTENANCE: 'low',
  BREAKDOWN_REPAIR: 'critical',
  MODEL_CHANGE: 'low',
  PROGRAM_CHANGE: 'low',
  TOOL_CHANGE: 'low',
  PLANNED_STOP: 'low',
};

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


  // 로컬스토리지에서 확인된 알림 조회
  const getAcknowledgedNotifications = useCallback((): Set<string> => {
    if (typeof window === 'undefined') return new Set();
    try {
      const acknowledged = localStorage.getItem(`notifications_acknowledged_${user?.id}`);
      return acknowledged ? new Set(JSON.parse(acknowledged)) : new Set();
    } catch {
      return new Set();
    }
  }, [user?.id]);

  // 로컬스토리지에 확인된 알림 저장
  const saveAcknowledgedNotification = useCallback((machineId: string, state: string) => {
    if (typeof window === 'undefined') return;
    try {
      const acknowledgedSet = getAcknowledgedNotifications();
      const notificationKey = `${machineId}_${state}`;
      acknowledgedSet.add(notificationKey);
      localStorage.setItem(
        `notifications_acknowledged_${user?.id}`,
        JSON.stringify(Array.from(acknowledgedSet))
      );
      console.log('💾 알림 확인 상태 저장:', notificationKey);
    } catch (error) {
      console.error('❌ 알림 확인 상태 저장 실패:', error);
    }
  }, [user?.id, getAcknowledgedNotifications]);

  // 실제 데이터베이스 기반 알림 생성 (중복 방지)
  const generateRealNotifications = useCallback(async (): Promise<Notification[]> => {
    try {
      console.log('🏭 설비 데이터 조회 시작');
      // 실제 설비 데이터 가져오기 (공용 캐시: 페이지의 다른 호출과 중복 요청을 합친다)
      const machines = await fetchMachines();
      console.log('🔧 로딩된 설비 수:', machines.length);

      // 이미 확인된 알림 조회
      const acknowledgedNotifications = getAcknowledgedNotifications();
      console.log('✅ 이미 확인된 알림 수:', acknowledgedNotifications.size);

      const notifications: Notification[] = [];

      // 비정상 상태 설비에 대한 알림 생성 (확인되지 않은 것만)
      console.log('🔍 비정상 상태 설비 검색 중...');

      const abnormalMachines = machines.filter((m: Machine) => m.current_state !== 'NORMAL_OPERATION');
      console.log('⚠️ 비정상 상태 설비 발견:', abnormalMachines.length, '대');

      machines.forEach((machine: Machine) => {
        if (machine.current_state !== 'NORMAL_OPERATION') {
          const notificationKey = `${machine.id}_${machine.current_state}`;

          // 이미 확인된 알림은 건너뛰기
          if (acknowledgedNotifications.has(notificationKey)) {
            console.log(`⏭️ 이미 확인된 알림 건너뛰기: ${machine.name} - ${machine.current_state}`);
            return;
          }

          console.log(`🚨 새 알림 생성: ${machine.name} - ${machine.current_state}`);

          // current_state 는 optional 이라 값이 없을 수도 있다. 그 경우 'unknown' 문구로 처리한다.
          const state = machine.current_state;
          const known = state !== undefined && state in STATE_SEVERITY;
          const severity: NotificationSeverity = (state && STATE_SEVERITY[state]) ?? 'high';
          // 문구는 번역 키로만 남기고, 실제 번역은 렌더링 시점에 수행한다.
          const messageKey = known
            ? `notifications.machineState.${state}`
            : 'notifications.machineState.unknown';

          notifications.push({
            id: notificationKey, // 고유한 키로 ID 설정
            type: state === 'BREAKDOWN_REPAIR' || state === 'TEMPORARY_STOP'
                  ? 'MACHINE_STOPPED' : 'MAINTENANCE_DUE',
            severity,
            titleKey: 'notifications.machineState.title',
            messageKey,
            messageParams: { machineName: machine.name },
            machine_id: machine.id,
            machine_name: machine.name,
            user_id: user?.id || '',
            created_at: new Date().toISOString(),
            read: false,
            acknowledged: false,
            status: 'active'
          });
        }
      });

      console.log('📊 최종 생성된 새 알림 수:', notifications.length);
      const finalNotifications = notifications.slice(0, 10);
      console.log('📋 반환할 알림 수:', finalNotifications.length);

      return finalNotifications; // 최대 10개만 표시
    } catch (error) {
      console.error('❌ generateRealNotifications 오류:', error);
      return [];
    }
  }, [user?.id, getAcknowledgedNotifications]);

  // 알림 목록 새로고침
  const refreshNotifications = useCallback(async () => {
    console.log('🔄 refreshNotifications 시작');
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      console.log('📞 generateRealNotifications 호출 시작');
      // 실제 데이터베이스 기반 알림 생성
      const realNotifications = await generateRealNotifications();
      console.log('📋 생성된 알림 데이터:', realNotifications);
      
      dispatch({ type: 'SET_NOTIFICATIONS', payload: realNotifications });
      dispatch({ type: 'SET_ERROR', payload: null });
      
      console.log('✅ 실제 데이터베이스 기반 알림 생성 완료:', realNotifications.length, '개');
    } catch (error) {
      console.error('❌ refreshNotifications 오류:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to fetch notifications' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
      console.log('🔄 refreshNotifications 완료');
    }
  }, [generateRealNotifications]);


  // 알림 추가
  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'created_at'>) => {
    const newNotification: Notification = {
      ...notification,
      id: Date.now().toString(),
      created_at: new Date().toISOString(),
    };

    dispatch({ type: 'ADD_NOTIFICATION', payload: newNotification });

    // Toast 알림 표시 (토스트는 즉시 소비되므로 여기서 번역해도 무방하다)
    const toastTitle = t(notification.titleKey);
    const toastMessage = `${notification.machine_name}: ${t(notification.messageKey, notification.messageParams)}`;

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
  }, [t]);

  // 알림 확인 처리 (로컬스토리지에 저장)
  const acknowledgeNotification = useCallback(async (id: string) => {
    try {
      console.log('✅ 알림 확인 처리:', id);

      // 현재 알림에서 machine_id와 state 추출
      const notification = state.notifications.find(n => n.id === id);
      if (notification) {
        // ID가 "machineId_state" 형식으로 되어 있음 (state 자체에 '_'가 포함될 수 있으므로 첫 '_'만 기준으로 분리)
        const separatorIndex = id.indexOf('_');
        if (separatorIndex > 0) {
          const machineId = id.slice(0, separatorIndex);
          const machineState = id.slice(separatorIndex + 1);
          if (machineId && machineState) {
            saveAcknowledgedNotification(machineId, machineState);
          }
        }
      }

      // UI에서 알림 제거 (확인된 알림은 더 이상 표시하지 않음)
      dispatch({ type: 'REMOVE_NOTIFICATION', payload: id });

      showToast({
        type: 'success',
        title: t('notifications.acknowledged'),
        message: t('notifications.acknowledgedMessage')
      });
    } catch (error) {
      console.error('Failed to acknowledge notification:', error);
      showToast({
        type: 'error',
        title: t('app.error'),
        message: t('notifications.acknowledgeError')
      });
    }
  }, [state.notifications, saveAcknowledgedNotification, t]);

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
        title: t('app.error'), 
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
        title: t('app.error'), 
        message: t('notifications.deleteError') 
      });
    }
  }, [t]);

  // 모든 알림 확인/삭제 (로컬스토리지에 저장)
  const clearAllNotifications = useCallback(async () => {
    try {
      console.log('🧹 모든 알림 확인 처리 시작');

      // 현재 모든 활성 알림을 확인됨으로 표시하고 로컬스토리지에 저장
      state.notifications.forEach(notification => {
        // state 자체에 '_'가 포함될 수 있으므로 첫 '_'만 기준으로 분리
        const separatorIndex = notification.id.indexOf('_');
        if (separatorIndex > 0) {
          const machineId = notification.id.slice(0, separatorIndex);
          const machineState = notification.id.slice(separatorIndex + 1);
          if (machineId && machineState) {
            saveAcknowledgedNotification(machineId, machineState);
          }
        }
      });

      // UI에서 모든 알림 제거
      dispatch({ type: 'CLEAR_ALL_NOTIFICATIONS' });

      showToast({
        type: 'success',
        title: t('notifications.allCleared'),
        message: t('notifications.allClearedMessage')
      });

      console.log('✅ 모든 알림 확인 처리 완료');
    } catch (error) {
      console.error('Failed to clear all notifications:', error);
      showToast({
        type: 'error',
        title: t('app.error'),
        message: t('notifications.clearAllError')
      });
    }
  }, [state.notifications, saveAcknowledgedNotification, t]);

  // 읽지 않은 알림 수 계산
  const unreadCount = useMemo(
    () => state.notifications.filter(n => n.status === 'active').length,
    [state.notifications]
  );

  // 초기 데이터 로드 - 사용자 로그인 시 실제 알림 로딩
  useEffect(() => {
    if (user?.id) {
      console.log('🔄 NotificationContext 초기화 - 사용자 ID:', user.id);
      refreshNotifications();
    } else {
      console.log('❌ NotificationContext - 사용자 로그아웃됨, 알림 초기화');
      // 사용자 로그아웃 시 알림 초기화
      dispatch({ type: 'CLEAR_ALL_NOTIFICATIONS' });
      dispatch({ type: 'SET_LOADING', payload: false });
      dispatch({ type: 'SET_ERROR', payload: null });
    }
  }, [user?.id, refreshNotifications]);

  // context value를 메모이제이션한다.
  // 매 렌더마다 새 객체를 만들면 useNotifications()를 쓰는 모든 소비자가 불필요하게 리렌더된다.
  const contextValue: NotificationContextType = useMemo(() => ({
    notifications: state.notifications,
    unreadCount,
    addNotification,
    acknowledgeNotification,
    resolveNotification,
    clearNotification,
    clearAllNotifications,
    refreshNotifications,
  }), [
    state.notifications,
    unreadCount,
    addNotification,
    acknowledgeNotification,
    resolveNotification,
    clearNotification,
    clearAllNotifications,
    refreshNotifications,
  ]);

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