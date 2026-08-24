/**
 * 공장 컨텍스트 상수 (클라이언트·서버 공용).
 *
 * `factoryAuth.ts` 는 `supabase-admin`(service role key)을 import 하므로 **클라이언트
 * 컴포넌트에서 절대 import 하면 안 된다.** 쿠키 이름 하나 때문에 그 모듈을 끌어오면
 * 서비스 롤 키가 브라우저 번들에 들어갈 수 있다.
 *
 * 그래서 양쪽이 함께 쓰는 값만 여기 둔다. 이 파일은 아무것도 import 하지 않는다.
 */

/** 사용자가 고른 공장 코드를 담는 쿠키. 값 자체는 권위가 없고 서버가 membership 으로 검증한다. */
export const FACTORY_COOKIE = 'almus_factory';
