import fs from 'fs';
import path from 'path';
import {
  isSessionExpired,
  notifySessionExpired,
  onSessionExpired,
  resetSessionExpiryNotice,
  __resetSessionExpiryForTests,
} from '@/lib/sessionExpiry';
import { shouldReportFailure } from '@/lib/errorReporting';

/**
 * 세션이 **로그인 폼을 거치지 않고** 돌아오는 경로를 못 박는다.
 *
 * ## 무엇이 문제였나 (적대적 감사에서 발견, 2026-08-01)
 *
 * 만료 표식(`sessionOver`)을 끄는 곳이 `AuthContext.login()` 하나뿐이었다. 그래서 이
 * 탭에서 로그인하지 않고 세션이 돌아오는 경로가 통째로 빠져 있었다.
 *
 *   탭 A 만료 → sessionOver = true
 *   탭 B 에서 로그인 → 탭 A 가 SIGNED_IN 을 받아 user 복구, 대시보드 정상 렌더
 *   그런데 sessionOver 는 여전히 true → 탭 A 의 실패 토스트가 **전부 침묵**
 *
 * 새로고침 전까지 그 탭은 어떤 실패도 말하지 않는다. 고치려던 증상("화면이 사실을
 * 말하지 않는다")이 정확히 뒤집힌 모양이다.
 *
 * 이 결함은 표식에 **역할이 하나 더 얹히면서** 생겼다. 원래는 중복 알림만 막았으므로
 * 남아 있어도 무해했다. `isSessionExpired()` 로 실패 보고까지 좌우하게 되자, 같은
 * 잔류 상태가 사용자에게 보이는 결함이 됐다.
 *
 * `AuthContext` 의 `markSessionRecovered()` 가 SIGNED_IN·TOKEN_REFRESHED 성공 지점에서
 * 이걸 끈다. 여기서는 그 계약을 모듈 수준으로 고정한다.
 */
describe('세션 복구는 실패 보고를 다시 연다', () => {
  beforeEach(() => {
    __resetSessionExpiryForTests();
  });

  it('만료된 뒤에는 실패를 말하지 않는다', () => {
    notifySessionExpired();

    expect(isSessionExpired()).toBe(true);
    expect(shouldReportFailure(new Error('설비 목록 조회 실패'))).toBe(false);
  });

  it('로그인을 거치지 않고 세션이 돌아와도(다른 탭 SIGNED_IN) 다시 말한다', () => {
    notifySessionExpired();

    // AuthContext.markSessionRecovered() 가 하는 일 — 세션이 확정되는 지점에서 표식을 끈다.
    resetSessionExpiryNotice();

    expect(isSessionExpired()).toBe(false);
    expect(shouldReportFailure(new Error('설비 목록 조회 실패'))).toBe(true);
  });

  it('복구 뒤 다시 만료되면 알림이 한 번 더 나간다', () => {
    // 표식을 끄는 일은 "다음 만료를 알릴 수 있게" 하는 일이기도 하다. 둘은 같은 값이라
    // 한쪽만 되는 상태가 존재할 수 없어야 한다.
    let notices = 0;
    const stop = onSessionExpired(() => { notices += 1; });

    notifySessionExpired();
    notifySessionExpired(); // 중복은 무시된다
    expect(notices).toBe(1);

    resetSessionExpiryNotice();
    notifySessionExpired();
    expect(notices).toBe(2);
    expect(shouldReportFailure()).toBe(false);

    stop();
  });

  /**
   * 위 세 테스트는 **모듈의 계약**만 본다. 실제 결함은 "AuthContext 가 그 계약을 부르지
   * 않는다"였으므로, 배선 자체도 확인해야 같은 결함을 다시 잡는다.
   *
   * 컴포넌트를 띄워 Supabase 인증 이벤트를 흉내내려면 클라이언트 전체를 모킹해야 하고,
   * 그렇게 만든 테스트는 모킹이 실제와 어긋나는 순간 조용히 무의미해진다. 여기서는
   * 더 얕지만 어긋나지 않는 것을 본다 — **세션이 확정되는 세 자리에 호출이 있는가.**
   */
  it('AuthContext 는 로그인·SIGNED_IN·TOKEN_REFRESHED 세 곳에서 복구를 표시한다', () => {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'src/contexts/AuthContext.tsx'),
      'utf8',
    );

    /**
     * 주석은 뺀다. 처음에는 원문 그대로 셌는데, 헬퍼의 JSDoc 이 자기가 부르는 함수
     * 이름을 설명으로 적고 있어서 그것까지 호출로 세었다. 문서를 고치면 깨지는 테스트는
     * 코드가 아니라 산문을 지키는 셈이다.
     */
    const source = raw
      .split('\n')
      .filter(line => {
        const t = line.trim();
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
      })
      .join('\n');

    // 정의부는 `markSessionRecovered = useCallback` 이라 이 정규식에 걸리지 않는다.
    // 남는 건 호출부뿐 — 로그인, SIGNED_IN, TOKEN_REFRESHED.
    const calls = source.match(/markSessionRecovered\(\)/g) ?? [];
    expect(calls.length).toBe(3);

    // 표식을 끄는 일이 헬퍼 밖으로 흩어지지 않았는지 본다 — 흩어지는 순간 한 곳이
    // 빠지고, 그게 이번 결함이었다.
    const rawResets = source.match(/resetSessionExpiryNotice\(\)/g) ?? [];
    expect(rawResets.length).toBe(1); // markSessionRecovered 안의 단 하나
  });
});
