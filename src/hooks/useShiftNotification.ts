'use client';

import { useState, useEffect, useCallback } from 'react';
import { getCurrentShiftInfo, shouldShowShiftEndNotification, getTimeUntilShiftEnd } from '@/utils/shiftUtils';
import { Machine } from '@/types';

interface UseShiftNotificationProps {
  machines: Machine[];
  enabled?: boolean;
}

interface ShiftNotificationState {
  showNotification: boolean;
  currentShift: 'A' | 'B' | null;
  minutesUntilEnd: number;
  pendingMachines: Machine[];
}

export const useShiftNotification = ({ 
  machines, 
  enabled = true 
}: UseShiftNotificationProps) => {
  const [state, setState] = useState<ShiftNotificationState>({
    showNotification: false,
    currentShift: null,
    minutesUntilEnd: 0,
    pendingMachines: []
  });

  const [notificationShown, setNotificationShown] = useState(false);
  const [postponedUntil, setPostponedUntil] = useState<Date | null>(null);

  // 교대 상태 업데이트
  const updateShiftState = useCallback(() => {
    if (!enabled) return;

    const now = new Date();
    const shiftInfo = getCurrentShiftInfo(now);
    const minutesUntilEnd = getTimeUntilShiftEnd(now);
    const shouldShow = shouldShowShiftEndNotification(now);

    // 연기된 시간이 지났는지 확인
    const isPostponeExpired = postponedUntil ? now > postponedUntil : true;

    setState(prev => ({
      ...prev,
      currentShift: shiftInfo.shift,
      minutesUntilEnd,
      showNotification: shouldShow && !notificationShown && isPostponeExpired && machines.length > 0,
      pendingMachines: machines
    }));

    // 알림이 표시되면 플래그 설정
    if (shouldShow && !notificationShown && isPostponeExpired) {
      setNotificationShown(true);
    }

    // 교대가 바뀌면 알림 상태 리셋
    if (minutesUntilEnd === 0) {
      setNotificationShown(false);
      setPostponedUntil(null);
    }
  }, [enabled, machines, notificationShown, postponedUntil]);

  // 주기적으로 교대 상태 체크 (1분마다)
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(updateShiftState, 60 * 1000);
    
    // 컴포넌트 마운트 시 즉시 체크
    updateShiftState();
    
    return () => clearInterval(interval);
  }, [updateShiftState, enabled]);

  // 알림 닫기
  const dismissNotification = useCallback(() => {
    setState(prev => ({ ...prev, showNotification: false }));
  }, []);

  // 나중에 입력하기 (10분 후 다시 알림)
  const postponeNotification = useCallback(() => {
    const postponeTime = new Date(Date.now() + 10 * 60 * 1000); // 10분 후
    setPostponedUntil(postponeTime);
    setNotificationShown(false);
    setState(prev => ({ ...prev, showNotification: false }));
  }, []);

  // 설비 완료 처리
  const markMachineCompleted = useCallback((machineId: string) => {
    setState(prev => ({
      ...prev,
      pendingMachines: prev.pendingMachines.filter(m => m.id !== machineId)
    }));
  }, []);

  // 모든 설비 완료 시 알림 자동 닫기
  useEffect(() => {
    if (state.pendingMachines.length === 0 && state.showNotification) {
      dismissNotification();
    }
  }, [state.pendingMachines.length, state.showNotification, dismissNotification]);

  return {
    ...state,
    dismissNotification,
    postponeNotification,
    markMachineCompleted,
    isPostponed: postponedUntil !== null && new Date() < postponedUntil
  };
};

export default useShiftNotification;