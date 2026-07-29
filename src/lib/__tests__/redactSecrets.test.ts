import { redactSecrets } from '../redactSecrets';

/**
 * 이 테스트가 지키는 것은 "비밀 값이 로그 문자열에 나타나지 않는다" 하나다.
 * 그래서 단언은 전부 **직렬화 결과 안에 원래 값이 없음**으로 쓴다 — 로그에 실리는 것이
 * 정확히 그 문자열이기 때문이다. 키 이름 비교로 단언하면 구현을 따라 쓰는 것에 불과하다.
 */
describe('redactSecrets', () => {
  it('비밀번호를 직렬화 결과에서 지운다', () => {
    // 테스트 픽스처에도 실제 비밀번호를 쓰지 않는다 — 그러면 유출 지점이 한 곳 늘어난다.
    const body = { email: 'a@b.com', password: 'fixture-not-a-real-password', name: '홍길동' };

    const serialized = JSON.stringify(redactSecrets(body));

    expect(serialized).not.toContain('fixture-not-a-real-password');
    // 진단에 필요한 나머지 필드는 살아 있어야 한다 — 통째로 지우면 로그가 쓸모없어진다.
    expect(serialized).toContain('a@b.com');
    expect(serialized).toContain('홍길동');
  });

  it.each([
    ['password', 'pw-secret'],
    ['newPassword', 'pw-secret'],
    ['password_confirm', 'pw-secret'],
    ['accessToken', 'tok-secret'],
    ['apiKey', 'key-secret'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'srk-secret'],
    ['authorization', 'Bearer secret'],
  ])('키 %s 의 값을 지운다', (key, value) => {
    expect(JSON.stringify(redactSecrets({ [key]: value }))).not.toContain(value);
  });

  it('중첩 객체와 배열 안쪽까지 지운다', () => {
    const body = {
      users: [{ name: 'a', credentials: { password: 'nested-secret' } }],
    };

    expect(JSON.stringify(redactSecrets(body))).not.toContain('nested-secret');
  });

  it('입력 객체를 변경하지 않는다', () => {
    // 로깅이 요청 처리에 영향을 주면 안 된다 — 지워진 본문으로 계정을 만들면 안 되니까.
    const body = { password: 'original' };

    redactSecrets(body);

    expect(body.password).toBe('original');
  });

  it('순환 참조가 있어도 던지지 않는다', () => {
    const body: Record<string, unknown> = { password: 'circ-secret' };
    body.self = body;

    expect(() => JSON.stringify(redactSecrets(body))).not.toThrow();
    expect(JSON.stringify(redactSecrets(body))).not.toContain('circ-secret');
  });

  it('원시값은 그대로 통과시킨다', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets('plain')).toBe('plain');
  });
});
