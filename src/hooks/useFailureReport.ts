'use client';

import { App } from 'antd';
import { useCallback } from 'react';
import { shouldReportFailure } from '@/lib/errorReporting';

/**
 * 요청이 실패했을 때 사용자에게 알리는 **유일한** 통로.
 *
 * ## `message.error` 와 어떻게 다른가 — 이 구분이 요점이다
 *
 * 예전에는 두 가지가 같은 호출로 섞여 있었다.
 *
 * | 무엇 | 예 | 세션이 끝났을 때 |
 * |---|---|---|
 * | **요청 실패를 도메인 언어로 옮겨 적음** | "대시보드 데이터를 불러오는데 실패했습니다" | 원인이 로그인이므로 **말하면 안 된다** |
 * | **입력 검증 / 서버가 준 도메인 답** | "설비를 먼저 선택하세요", "이미 있는 모델명입니다" | 애초에 요청이 없었거나, 서버가 준 진짜 답 |
 *
 * 코드에서는 둘 다 `message.error(...)` 한 줄이라 구분할 수 없었고, 그래서 원인을
 * 구분하는 자리가 어디에도 없었다. 이제 앞의 것은 `reportFailure` 를 지나고 뒤의 것은
 * `message.error` 로 남는다 — **호출 형태만 보고도 어느 쪽인지 알 수 있다.**
 *
 * ## 왜 훅인가
 *
 * antd 정적 `message` 는 `ConfigProvider` 의 테마·로케일 컨텍스트를 못 받아 경고를 낸다.
 * `App.useApp()` 인스턴스를 쓰면 `providers.tsx` 의 `<App>` 아래에서 올바르게 렌더된다.
 *
 * ## 의존성 배열에 넣어도 되는가 — 된다
 *
 * 네 곳에서 이 함수를 의존성 배열에 넣었고, 그중 `app/reports/page.tsx` 의 effect 는
 * 설비 목록을 네트워크로 가져온다. 이 함수의 identity 가 불안정하면 그 effect 가 상위
 * 리렌더마다 다시 돌아 요청이 늘어난다.
 *
 * 안전한 이유는 antd 가 `App.useApp()` 의 `message` 를 `useMemo` 로 고정하기 때문이다 —
 * `providers.tsx` 처럼 `notification={{...}}` 을 인라인 리터럴로 넘겨도 유지된다.
 * **이건 우리 코드가 아니라 antd 의 성질**이라 버전이 올라가면 조용히 깨질 수 있다.
 * `__tests__/useFailureReportStability.test.tsx` 가 실제 렌더로 그걸 지킨다.
 *
 * ## 사용
 *
 * ```ts
 * const reportFailure = useFailureReport();
 * // ...
 * } catch (error) {
 *   console.error('Error fetching dashboard data:', error);
 *   reportFailure('대시보드 데이터를 불러오는데 실패했습니다', error);
 * }
 * ```
 *
 * `console.error` 는 **지우지 않는다.** 화면에 말하지 않기로 한 실패도 흔적은 남아야
 * 조사할 수 있다 — 조용히 삼킨 실패는 재현조차 못 한다.
 */
export function useFailureReport(): (text: string, error?: unknown) => void {
  const { message } = App.useApp();

  return useCallback((text: string, error?: unknown) => {
    if (!shouldReportFailure(error)) return;
    message.error(text);
  }, [message]);
}
