/**
 * 실패를 도메인 언어로 옮겨 적어도 되는지 판정하는 규칙을 고정한다.
 *
 * 이 판정이 틀리는 방향은 두 가지이고 무게가 다르다.
 * - **너무 좁으면**: 만료 직후 "대시보드 데이터를 불러오는데 실패했습니다" 가 다시 샌다.
 *   눈에 보이는 버그다.
 * - **너무 넓으면**: 진짜 도메인 실패가 조용히 사라진다. 아무 흔적이 없어 재현조차 못 한다.
 *   이쪽이 더 나쁘므로 아래 "삼키지 않는다" 케이스들을 함께 못 박는다.
 */

import { isSessionFailure, shouldReportFailure } from '@/lib/errorReporting';
import {
  notifySessionExpired,
  resetSessionExpiryNotice,
  __resetSessionExpiryForTests,
} from '@/lib/sessionExpiry';

describe('errorReporting', () => {
  beforeEach(() => {
    __resetSessionExpiryForTests();
  });

  describe('isSessionFailure — 오류 모양으로 세션 문제를 알아본다', () => {
    it('status 401 은 세션 문제다 (Response·Supabase AuthError 가 공유하는 모양)', () => {
      expect(isSessionFailure({ status: 401, message: 'JWT expired' })).toBe(true);
    });

    it('PostgREST 의 PGRST301 은 세션 문제다', () => {
      expect(isSessionFailure({ code: 'PGRST301', message: 'JWT expired' })).toBe(true);
    });

    it.each([
      ['403 권한 부족 — "볼 수 없다"는 진짜 답이다', { status: 403 }],
      ['500 서버 오류', { status: 500 }],
      ['23505 중복 — 서버가 준 도메인 답이다', { code: '23505' }],
      ['42501 RLS 거부 — 권한 문제지 세션 문제가 아니다', { code: '42501' }],
      ['평범한 Error', new Error('네트워크 연결 실패')],
      ['문자열', 'boom'],
      ['null', null],
      ['undefined', undefined],
    ])('%s 은(는) 세션 문제가 아니다', (_label, error) => {
      expect(isSessionFailure(error)).toBe(false);
    });

    it('전역 Response 가 없는 환경에서도 던지지 않는다', () => {
      /**
       * 이 함수는 `catch` 안에서 불린다. 여기서 예외가 나면 원래 실패가 그 예외에 묻혀
       * 사라지고, 사용자는 아무 안내도 못 받는다. `instanceof Response` 로 갈라 보던
       * 구현이 정확히 그랬다 — 전역이 없으면 값과 무관하게 ReferenceError 였다.
       */
      const globals = globalThis as { Response?: unknown };
      const saved = globals.Response;
      delete globals.Response;
      try {
        expect(() => isSessionFailure({ status: 401 })).not.toThrow();
        expect(isSessionFailure({ status: 401 })).toBe(true);
      } finally {
        if (saved !== undefined) globals.Response = saved;
      }
    });

    it('실제 Response 객체도 status 로 판정된다', () => {
      // 전역이 있는 환경에서만 확인한다 — 없다고 이 규칙이 달라지지는 않는다.
      if (typeof Response === 'undefined') return;
      expect(isSessionFailure(new Response(null, { status: 401 }))).toBe(true);
      expect(isSessionFailure(new Response(null, { status: 403 }))).toBe(false);
    });
  });

  describe('shouldReportFailure — 세션이 끝났으면 도메인 언어로 말하지 않는다', () => {
    it('평소에는 말한다', () => {
      expect(shouldReportFailure(new Error('조회 실패'))).toBe(true);
    });

    it('오류 객체가 없어도 평소에는 말한다', () => {
      expect(shouldReportFailure()).toBe(true);
    });

    it('세션이 끝난 뒤에는 오류 객체와 무관하게 침묵한다', () => {
      notifySessionExpired();
      expect(shouldReportFailure(new Error('비가동 내역을 불러오지 못했습니다'))).toBe(false);
      expect(shouldReportFailure()).toBe(false);
    });

    it('늦게 도착한 실패도 같은 상태를 보므로 함께 걸린다', () => {
      // authFetch 는 응답을 돌려주기 전에 알린다 → 뒤늦게 깨어난 catch 도 이 값을 본다.
      notifySessionExpired();
      const lateArrivals = [new Error('A'), new Error('B'), new Error('C')];
      expect(lateArrivals.map((e) => shouldReportFailure(e))).toEqual([false, false, false]);
    });

    it('다시 로그인하면 도메인 실패를 다시 말한다', () => {
      notifySessionExpired();
      expect(shouldReportFailure()).toBe(false);

      resetSessionExpiryNotice();
      expect(shouldReportFailure(new Error('조회 실패'))).toBe(true);
    });

    it('세션이 멀쩡해도 401 을 든 실패는 삼킨다 — authFetch 를 지나지 않는 경로용', () => {
      expect(shouldReportFailure({ status: 401 })).toBe(false);
    });

    it('세션이 멀쩡하면 403·중복은 반드시 말한다', () => {
      expect(shouldReportFailure({ status: 403 })).toBe(true);
      expect(shouldReportFailure({ code: '23505' })).toBe(true);
    });
  });
});
