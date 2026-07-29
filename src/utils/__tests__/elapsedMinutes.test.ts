import { elapsedMinutesSince } from '../elapsedMinutes';

/**
 * 2026-07-29 브라우저 테스트에서 잡은 회귀.
 *
 * 운영자 콘솔에서 비가동을 재개한 직후 설비 카드가 **"지속 시간: -1분"** 을 보여줬다.
 * 시작 시각은 서버가 찍고 경과는 브라우저 시계로 재는데, 브라우저가 DB 보다 약 1초
 * 느렸기 때문이다. 음수를 `Math.floor` 하면 0 이 아니라 -1 이 나온다.
 */

const MINUTE = 60_000;
const START = Date.parse('2026-07-29T09:11:31.365Z');

describe('elapsedMinutesSince', () => {
  it('브라우저 시계가 서버보다 느려도 음수를 내지 않는다', () => {
    // 이 한 줄이 결함의 전부다. Math.floor(-0.016) === -1 이라서 "-1분" 이 떴다.
    expect(elapsedMinutesSince(START, START - 965)).toBe(0);
  });

  it('1분 미만은 0분', () => {
    expect(elapsedMinutesSince(START, START)).toBe(0);
    expect(elapsedMinutesSince(START, START + 59_999)).toBe(0);
  });

  it('경과한 분을 내림한다', () => {
    expect(elapsedMinutesSince(START, START + MINUTE)).toBe(1);
    expect(elapsedMinutesSince(START, START + 2 * MINUTE + 59_000)).toBe(2);
    expect(elapsedMinutesSince(START, START + 125 * MINUTE)).toBe(125);
  });

  it('ISO 문자열·Date·epoch 를 모두 받는다', () => {
    const now = START + 5 * MINUTE;
    expect(elapsedMinutesSince('2026-07-29T09:11:31.365Z', now)).toBe(5);
    expect(elapsedMinutesSince(new Date(START), now)).toBe(5);
    expect(elapsedMinutesSince(START, now)).toBe(5);
  });

  it('파싱 불가한 값은 NaN 대신 0', () => {
    // NaN 이 화면까지 흘러가면 "NaN분" 이 뜬다 — 음수보다 나쁘다.
    expect(elapsedMinutesSince('not-a-date', START)).toBe(0);
    expect(elapsedMinutesSince(new Date('nope'), START)).toBe(0);
  });
});
