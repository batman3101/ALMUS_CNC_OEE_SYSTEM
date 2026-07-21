'use client';

import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  Notification,
  NotificationContextType,
  NotificationSeverity
} from '@/types/notifications';
import type { Machine, MachineState } from '@/types';
import { useAuth } from './AuthContext';
import { showToast } from '@/components/notifications';
import { useLanguage } from './LanguageContext';
import { fetchMachines, invalidateMachinesCache } from '@/lib/machinesCache';
import { supabase } from '@/lib/supabase';

// 설비 상태 변경을 놓치지 않기 위한 폴백 폴링 주기.
// Realtime 구독이 끊겨도 이 주기로는 반드시 따라잡는다.
const NOTIFICATION_POLL_INTERVAL_MS = 60_000;

// Realtime 이벤트가 연달아 오면(대량 상태 변경) 매번 재조회하지 않도록 묶는다.
const REALTIME_DEBOUNCE_MS = 1_000;

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
type NotificationContextValue = NotificationContextType & {
  loading: boolean;
  error: string | null;
  stale: boolean;
};

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

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

  // 로컬스토리지에 확인된 알림 키 집합 기록 (저장/삭제 공통 경로)
  const writeAcknowledgedNotifications = useCallback((keys: Set<string>) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        `notifications_acknowledged_${user?.id}`,
        JSON.stringify(Array.from(keys))
      );
    } catch (error) {
      console.error('❌ 알림 확인 상태 저장 실패:', error);
    }
  }, [user?.id]);

  // 로컬스토리지에 확인된 알림 저장
  const saveAcknowledgedNotification = useCallback((machineId: string, state: string) => {
    if (typeof window === 'undefined') return;
    const acknowledgedSet = getAcknowledgedNotifications();
    const notificationKey = `${machineId}_${state}`;
    acknowledgedSet.add(notificationKey);
    writeAcknowledgedNotifications(acknowledgedSet);
    console.log('💾 알림 확인 상태 저장:', notificationKey);
  }, [getAcknowledgedNotifications, writeAcknowledgedNotifications]);

  // 실제 데이터베이스 기반 알림 생성 (중복 방지)
  const generateRealNotifications = useCallback(async (): Promise<Notification[]> => {
    try {
      console.log('🏭 설비 데이터 조회 시작');
      // 알림은 "지금" 상태를 보는 것이므로 TTL 캐시를 우회한다.
      // (캐시된 30초 전 목록으로 알림을 만들면 방금 바뀐 상태를 놓친다)
      const machines = await fetchMachines({ force: true });
      console.log('🔧 로딩된 설비 수:', machines.length);

      // 이미 확인된 알림 조회
      const acknowledgedNotifications = getAcknowledgedNotifications();
      console.log('✅ 이미 확인된 알림 수:', acknowledgedNotifications.size);

      // 정상 운전으로 복귀한 설비의 확인 이력은 지운다.
      // 확인 키는 (설비, 상태) 쌍이라 지우지 않으면 "한 번 확인한 고장은 그 설비에서 영원히 다시 알리지 않음"이 된다.
      // 정상 복귀 = 그 고장 발생 건의 종료이므로, 여기서 지워야 다음 고장이 새 알림으로 뜬다.
      let acknowledgedChanged = false;
      machines.forEach((machine: Machine) => {
        if (machine.current_state !== 'NORMAL_OPERATION') return;
        const machinePrefix = `${machine.id}_`;
        acknowledgedNotifications.forEach(key => {
          if (key.startsWith(machinePrefix)) {
            acknowledgedNotifications.delete(key);
            acknowledgedChanged = true;
          }
        });
      });
      if (acknowledgedChanged) {
        writeAcknowledgedNotifications(acknowledgedNotifications);
        console.log('🔄 정상 복귀 설비의 알림 확인 이력 초기화, 남은 확인 알림 수:', acknowledgedNotifications.size);
      }

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

      // 상한을 두지 않는다.
      //
      // 이전에는 slice(0, 10) 으로 잘랐고, 확인(acknowledge) 후에도 다음 알림을 보충 조회하지
      // 않았다. 그래서 비정상 설비가 10대를 넘으면 11번째부터는 로그인 세션이 끝날 때까지
      // 화면에 나타나지 않았다. 설비 800대인 공장에서 비정상 10대는 드물지 않다.
      //
      // 심각도 순으로 정렬해 중요한 것이 위로 오게 한다. 목록 자체는 잘라내지 않는다
      // (확인한 알림은 이미 위에서 걸러져 있다).
      const severityRank: Record<NotificationSeverity, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3
      };
      notifications.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

      console.log('📊 최종 생성된 새 알림 수:', notifications.length);

      return notifications;
    } catch (error) {
      console.error('❌ generateRealNotifications 오류:', error);
      // 조회 실패와 실제 알림 0건은 의미가 다르다. 실패를 []로 바꾸면 기존 활성 알림을
      // 정상적인 빈 결과로 덮어써 장애 중에 경보가 사라진다.
      throw error;
    }
  }, [user?.id, getAcknowledgedNotifications, writeAcknowledgedNotifications]);

  // 인증 실패(401/403) 연속 횟수와 그에 따른 폴링 건너뛰기 잔여 횟수.
  // 만료된 토큰으로 매 폴링 틱마다 재시도하면 서버 로그가 401 로 도배된다(자체 감사 #7 관찰).
  // 성공하면 리셋되고, user 가 바뀌면(재로그인) effect 초기화에서 리셋된다.
  const authFailStreakRef = useRef(0);
  const skipPollsRef = useRef(0);

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
      authFailStreakRef.current = 0;
      skipPollsRef.current = 0;

      console.log('✅ 실제 데이터베이스 기반 알림 생성 완료:', realNotifications.length, '개');
    } catch (error) {
      console.error('❌ refreshNotifications 오류:', error);
      const msg = error instanceof Error ? error.message : '';
      if (/HTTP 40[13]/.test(msg)) {
        authFailStreakRef.current += 1;
        // 연속 실패 횟수에 지수적으로 비례해 폴링을 건너뛴다(최대 32틱 ≈ 세션 갱신 대기).
        skipPollsRef.current = Math.min(2 ** authFailStreakRef.current, 32);
        console.warn(`⏸️ 알림 폴링 백오프: 인증 실패 ${authFailStreakRef.current}회, ${skipPollsRef.current}틱 건너뜀`);
      }
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

  // 최신 refreshNotifications 를 구독/타이머 콜백에서 참조하기 위한 ref.
  // (구독 effect 가 refreshNotifications 를 의존성으로 가지면 콜백이 새로 만들어질 때마다
  //  채널을 다시 구독하게 된다)
  const refreshRef = useRef(refreshNotifications);
  refreshRef.current = refreshNotifications;

  // 초기 데이터 로드 + 설비 상태 변경 추적
  //
  // 이전에는 이 effect 가 user.id 가 바뀔 때 한 번 도는 것이 전부였고, refreshNotifications 를
  // 호출하는 다른 곳도 앱 전체에 없었다. 즉 알림은 "로그인 시점의 스냅샷"이었다.
  // 로그인 후 설비가 고장 나도 새 알림이 생기지 않았고, 정상 복귀해도 확인 이력이 지워지지
  // 않아 다음 고장이 영영 안 뜨는 상태가 됐다.
  //
  // 그래서 (a) machines 테이블 Realtime 구독과 (b) 폴백 폴링을 함께 건다.
  useEffect(() => {
    if (!user?.id) {
      console.log('❌ NotificationContext - 사용자 로그아웃됨, 알림 초기화');
      dispatch({ type: 'CLEAR_ALL_NOTIFICATIONS' });
      dispatch({ type: 'SET_LOADING', payload: false });
      dispatch({ type: 'SET_ERROR', payload: null });
      return;
    }

    console.log('🔄 NotificationContext 초기화 - 사용자 ID:', user.id);

    // 재로그인/사용자 전환 시 인증 백오프를 리셋한다.
    authFailStreakRef.current = 0;
    skipPollsRef.current = 0;

    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const runRefresh = () => {
      if (cancelled) return;
      // 인증 실패 백오프 중이면 이번 틱은 건너뛴다 (만료 토큰으로 401 도배 방지).
      if (skipPollsRef.current > 0) {
        skipPollsRef.current -= 1;
        return;
      }
      // 설비 상태가 바뀌었으므로 캐시된 목록을 버린다
      invalidateMachinesCache();
      refreshRef.current();
    };

    runRefresh();

    // (a) 설비 상태 변경 실시간 구독.
    //
    // 이 Provider 는 루트 레이아웃에 있으므로 여기서 예외가 나가면 앱 전체가 하얗게 된다.
    // Realtime 은 부가 기능이고 아래 폴링이 같은 일을 더 느리게 해내므로, 구독 실패는
    // 로그만 남기고 조용히 폴링으로 강등한다.
    let channel: RealtimeChannel | null = null;
    try {
      channel = supabase
        .channel('notification-machine-changes')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'machines' },
          () => {
            // 대량 상태 변경이 연달아 들어와도 한 번만 재조회한다
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(runRefresh, REALTIME_DEBOUNCE_MS);
          }
        )
        .subscribe();
    } catch (error) {
      console.error('❌ 알림 실시간 구독 실패 - 폴링으로 대체합니다:', error);
    }

    // (b) Realtime 이 끊기거나 구독에 실패해도 따라잡기 위한 폴백 폴링
    const pollTimer = setInterval(runRefresh, NOTIFICATION_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(pollTimer);
      try {
        channel?.unsubscribe();
      } catch (error) {
        console.error('❌ 알림 실시간 구독 해제 실패:', error);
      }
    };
  }, [user?.id]);

  // context value를 메모이제이션한다.
  // 매 렌더마다 새 객체를 만들면 useNotifications()를 쓰는 모든 소비자가 불필요하게 리렌더된다.
  const contextValue: NotificationContextValue = useMemo(() => ({
    notifications: state.notifications,
    unreadCount,
    addNotification,
    acknowledgeNotification,
    resolveNotification,
    clearNotification,
    clearAllNotifications,
    refreshNotifications,
    loading: state.loading,
    error: state.error,
    stale: state.error !== null,
  }), [
    state.notifications,
    unreadCount,
    addNotification,
    acknowledgeNotification,
    resolveNotification,
    clearNotification,
    clearAllNotifications,
    refreshNotifications,
    state.loading,
    state.error,
  ]);

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
};

// 알림 컨텍스트 훅
export const useNotifications = (): NotificationContextValue => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
