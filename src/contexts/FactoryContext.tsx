'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '@/lib/authFetch';
import { useAuth } from '@/contexts/AuthContext';
import { setCurrentFactoryScope } from '@/lib/realtimeScope';

export interface FactoryOption {
  code: string;
  name: string;
  role: string;
}

interface FactoryState {
  /** 서버가 판정한 현재 공장. 아직 모르면 null. */
  factoryId: string | null;
  factoryCode: string | null;
  isGlobalAdmin: boolean;
  canSwitch: boolean;
  available: FactoryOption[];
  /** 첫 조회가 끝났는가. 실패로 끝난 경우도 true 다. */
  resolved: boolean;
}

const EMPTY: FactoryState = {
  factoryId: null,
  factoryCode: null,
  isGlobalAdmin: false,
  canSwitch: false,
  available: [],
  resolved: false,
};

const FactoryContext = createContext<FactoryState>(EMPTY);

/**
 * 현재 세션이 어느 공장에 있는지 **한 번만** 조회해 앱 전체에 나눠 준다.
 *
 * ## 왜 Context 인가
 *
 * 공장 정보를 필요로 하는 곳이 화면 한 곳이 아니다:
 *   - 헤더 배지·전환기 (FactorySwitcher)
 *   - Realtime 채널 이름과 서버 측 필터 (useRealtimeData, useMachines, ...)
 *
 * 각자 `/api/factory-context` 를 부르면 같은 답을 여러 번 받아 오고, 더 나쁘게는 **서로 다른
 * 시점의 답**을 들고 다니게 된다. 화면은 ALV 를 가리키면서 구독은 ALT 를 듣는 상태가
 * 만들어질 수 있다.
 *
 * ## 값이 없을 때는 "모른다"로 둔다
 *
 * 조회에 실패하면 `factoryId` 는 null 로 남는다. 짐작해서 채우지 않는다 — 짐작한 공장으로
 * 구독을 걸면 그 순간 잘못된 공장을 듣는다. 소비자는 null 을 "아직 좁힐 수 없다"로 읽고,
 * 그때 경계는 RLS 가 지킨다(구독 필터는 좁히기 위한 것이고 경계 그 자체가 아니다).
 *
 * ## 로그아웃하면 비운다
 *
 * 세션이 사라진 뒤에도 이전 공장이 남아 있으면, 다음 로그인 사용자가 자기 공장이 확정되기
 * 전 짧은 순간 남의 공장 값으로 구독을 건다.
 */
export function FactoryProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<FactoryState>(EMPTY);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/factory-context', { cache: 'no-store' });
      if (!res.ok) {
        if (isMountedRef.current) setState(prev => ({ ...prev, resolved: true }));
        return;
      }
      const json = await res.json();
      if (!isMountedRef.current) return;
      if (!json?.success) {
        setState(prev => ({ ...prev, resolved: true }));
        return;
      }
      setState({
        factoryId: json.current?.id ?? null,
        factoryCode: json.current?.code ?? null,
        isGlobalAdmin: Boolean(json.isGlobalAdmin),
        canSwitch: Boolean(json.canSwitch),
        available: json.available ?? [],
        resolved: true,
      });
    } catch {
      // 공장 표시는 부가 정보다. 실패해도 화면을 막지 않는다 — 다만 값을 짐작하지 않는다.
      if (isMountedRef.current) setState(prev => ({ ...prev, resolved: true }));
    }
  }, []);

  useEffect(() => {
    if (!user) {
      // 로그아웃/세션 소실. 이전 공장을 남겨 두면 다음 사용자가 그 값으로 구독을 건다.
      setState(EMPTY);
      return;
    }
    void load();
  }, [user, load]);

  // React 밖에서도 현재 공장을 알아야 하는 곳이 있다 — `systemSettings.ts` 의 broadcast
  // 발신자는 Context 를 읽을 수 없다(@/lib/realtimeScope 의 설명 참고).
  useEffect(() => {
    setCurrentFactoryScope(state.factoryCode);
  }, [state.factoryCode]);

  const value = useMemo(() => state, [state]);

  return <FactoryContext.Provider value={value}>{children}</FactoryContext.Provider>;
}

export function useFactory(): FactoryState {
  return useContext(FactoryContext);
}
