import { render, act } from '@testing-library/react';
import { App, ConfigProvider } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useFailureReport } from '@/hooks/useFailureReport';

/**
 * `reportFailure` 의 identity 안정성을 못 박는다.
 *
 * ## 왜 이게 안전 조건인가
 *
 * 88곳을 쓸면서 `reportFailure` 를 네 곳의 의존성 배열에 넣었다
 * (`app/reports/page.tsx` 의 useEffect, `ThemeToggle`·`ProductionRecordInput`·
 * `useThemeToggle` 의 useCallback). 그중 reports 페이지의 effect 는 **설비 목록을
 * 네트워크로 가져온다.** identity 가 불안정하면 상위 리렌더마다 그 effect 가 다시 돌아
 * 요청이 늘어난다 — 오류 안내를 고치려다 요청을 만드는 셈이다.
 *
 * ## 이 테스트가 지키는 것은 우리 코드가 아니라 antd 의 성질이다
 *
 * `useFailureReport` 는 `App.useApp()` 의 `message` 로 `useCallback` 을 만든다. 그게
 * 안전한 이유는 antd 가 그 `message` 를 `useMemo` 로 고정하기 때문이고, 그건 **우리가
 * 통제하지 않는 성질**이다. antd 버전이 올라가며 조용히 깨질 수 있고, 깨지면 증상은
 * "오류 토스트"가 아니라 "reports 페이지가 테마 토글마다 재조회"로 나타나 원인을 찾기
 * 어렵다.
 *
 * 그래서 내부 구현을 읽어 추론하지 않고 **실제로 렌더해서 센다.**
 *
 * ⚠️ 상위 렌더 조건을 `providers.tsx` 와 똑같이 맞춰야 의미가 있다. 처음 이 테스트를
 * 쓸 때 프로브의 콜백을 인라인 화살표로 두는 바람에, 측정하려던 것이 아니라 **그 콜백**
 * 때문에 effect 가 돌아 없는 결함을 있다고 읽을 뻔했다. 아래 두 장치가 그 재발을 막는다:
 * 콜백은 ref 로 고정하고, `<App>` 에는 실제와 같은 인라인 객체 리터럴을 넘긴다.
 */

function Probe({
  onEffectRun,
  onReport,
}: {
  onEffectRun: () => void;
  onReport: (fn: unknown) => void;
}) {
  const reportFailure = useFailureReport();
  const [, setTick] = useState(0);

  onReport(reportFailure);

  /**
   * 콜백은 ref 로 고정한다.
   *
   * 처음에는 `onEffectRun` 을 그대로 의존성에 넣었는데, 그건 매 렌더 새로 만들어지는
   * 인라인 화살표 함수라 **그것 때문에** effect 가 돌았다. 측정하려는 변수가 아닌 것이
   * 결과를 만들면 이 테스트는 무엇도 증명하지 못한다. 의존성에는 `reportFailure` 만 둔다.
   */
  const onEffectRunRef = useRef(onEffectRun);
  onEffectRunRef.current = onEffectRun;

  useEffect(() => {
    onEffectRunRef.current();
  }, [reportFailure]);

  // 자식의 상태 변경으로 리렌더를 일으킨다 (요청 성공 후 setState 와 같은 상황).
  useEffect(() => {
    setTick(1);
  }, []);

  return null;
}

describe('useFailureReport 안정성', () => {
  it('자식 리렌더로는 reportFailure 가 바뀌지 않는다 — effect 가 다시 돌지 않는다', () => {
    let effectRuns = 0;
    const seen: unknown[] = [];

    render(
      <ConfigProvider>
        <App>
          <Probe onEffectRun={() => { effectRuns += 1; }} onReport={fn => seen.push(fn)} />
        </App>
      </ConfigProvider>,
    );

    // 두 번 이상 렌더됐는지 확인해야 이 테스트가 의미를 갖는다.
    expect(seen.length).toBeGreaterThan(1);
    // 그런데도 effect 는 한 번만 돌아야 한다.
    expect(effectRuns).toBe(1);
    expect(new Set(seen).size).toBe(1);
  });

  it('부모가 리렌더돼도 reportFailure 는 그대로다', () => {
    const seen: unknown[] = [];
    let effectRuns = 0;
    // 변수 재할당이 아니라 프로퍼티 쓰기로 꺼낸다 — 컴포넌트 밖 변수 재할당은 lint 금지.
    const control: { bump: () => void } = { bump: () => {} };

    function Parent() {
      const [n, setN] = useState(0);
      control.bump = () => setN(v => v + 1);
      return (
        <ConfigProvider>
          {/*
            `providers.tsx` 의 AntdConfigProvider 를 **그대로** 흉내낸다 — notification 을
            인라인 객체 리터럴로 넘긴다. 이게 중요하다: antd 는 그 prop 을 memo 의존성으로
            쓰므로, 리터럴이면 리렌더마다 내부 설정이 새로 계산된다. 이 조건을 빼면
            테스트는 실제보다 후한 환경에서 도는 셈이고 아무것도 보증하지 못한다.
          */}
          <App notification={{ placement: 'topRight', duration: 4.5, maxCount: 5, rtl: false }}>
            <span>{n}</span>
            <Probe onEffectRun={() => { effectRuns += 1; }} onReport={fn => seen.push(fn)} />
          </App>
        </ConfigProvider>
      );
    }

    render(<Parent />);
    const before = effectRuns;

    act(() => { control.bump(); });
    act(() => { control.bump(); });

    /**
     * 여기서 깨진다면 요청을 실어 나르는 effect 가 부모 렌더마다 다시 돈다는 뜻이다.
     * `app/reports/page.tsx` 에서는 그게 설비 목록 재조회가 된다.
     */
    expect(effectRuns).toBe(before);
    expect(new Set(seen).size).toBe(1);
  });
});
