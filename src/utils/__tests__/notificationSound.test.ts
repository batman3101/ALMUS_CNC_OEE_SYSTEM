/**
 * 알림음 — 자동재생 차단이 **정상 경로**임을 고정한다.
 *
 * 알림은 정의상 사용자 제스처 없이 온다. 그래서 브라우저가 오디오를 막는 것은 예외 상황이
 * 아니라 기본 상황이고, 그때 unhandled rejection 이 나면 알림 한 건마다 콘솔에 빨간 줄이
 * 하나씩 쌓인다. 소리 없는 알림보다 나쁘다.
 */
import {
  __resetNotificationSoundForTests,
  isNotificationSoundSupported,
  playNotificationSound,
} from '@/utils/notificationSound';

interface OscillatorStub {
  type: string;
  frequency: { setValueAtTime: jest.Mock };
  connect: jest.Mock;
  disconnect: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
  onended: (() => void) | null;
}

interface AudioContextStub {
  state: AudioContextState;
  currentTime: number;
  destination: unknown;
  resume: jest.Mock;
  createOscillator: jest.Mock;
  createGain: jest.Mock;
}

const created: AudioContextStub[] = [];
const oscillators: OscillatorStub[] = [];

function makeStub(initialState: AudioContextState, resumeTo: AudioContextState | 'reject') {
  const stub: AudioContextStub = {
    state: initialState,
    currentTime: 0,
    destination: {},
    resume: jest.fn(async () => {
      if (resumeTo === 'reject') throw new Error('not allowed');
      stub.state = resumeTo;
    }),
    createOscillator: jest.fn(() => {
      const oscillator: OscillatorStub = {
        type: '',
        frequency: { setValueAtTime: jest.fn() },
        connect: jest.fn(),
        disconnect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        onended: null,
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: jest.fn(() => ({
      gain: {
        setValueAtTime: jest.fn(),
        linearRampToValueAtTime: jest.fn(),
      },
      connect: jest.fn(),
      disconnect: jest.fn(),
    })),
  };
  created.push(stub);
  return stub;
}

const scope = window as unknown as Record<string, unknown>;

/** jsdom 에는 AudioContext 가 없다. 테스트가 직접 심는다. */
function installAudioContext(factory: (() => AudioContextStub) | null) {
  if (factory === null) {
    delete scope.AudioContext;
    delete scope.webkitAudioContext;
    return;
  }
  scope.AudioContext = function AudioContextMock() {
    return factory();
  };
}

describe('playNotificationSound', () => {
  beforeEach(() => {
    created.length = 0;
    oscillators.length = 0;
    delete scope.webkitAudioContext;
    // 모듈은 AudioContext 하나와 "막혔다" 경고 1회 플래그를 캐시한다. 그 상태가 테스트 사이에
    // 새면 두 번째 테스트가 첫 번째의 결론을 물려받는다.
    __resetNotificationSoundForTests();
  });

  afterAll(() => {
    delete scope.AudioContext;
    delete scope.webkitAudioContext;
  });

  it('재생 가능하면 소리를 시작한다', async () => {
    installAudioContext(() => makeStub('running', 'running'));

    await expect(playNotificationSound()).resolves.toBe(true);
    expect(oscillators.length).toBeGreaterThan(0);
    expect(oscillators[0].start).toHaveBeenCalled();
    expect(oscillators[0].stop).toHaveBeenCalled();
  });

  it('자동재생이 막히면 예외 없이 false 를 돌려주고 소리를 시작하지 않는다', async () => {
    // resume() 이 거부되는 브라우저.
    installAudioContext(() => makeStub('suspended', 'reject'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(playNotificationSound()).resolves.toBe(false);
    expect(oscillators).toHaveLength(0);
    warn.mockRestore();
  });

  it('resume() 이 성공해도 여전히 suspended 면 재생하지 않는다', async () => {
    // 제스처 전에는 resume() 이 resolve 되어도 상태가 그대로인 브라우저가 있다.
    installAudioContext(() => makeStub('suspended', 'suspended'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(playNotificationSound()).resolves.toBe(false);
    expect(oscillators).toHaveLength(0);
    warn.mockRestore();
  });

  it('막힌 경고는 알림마다가 아니라 한 번만 남긴다', async () => {
    installAudioContext(() => makeStub('suspended', 'reject'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await playNotificationSound();
    await playNotificationSound();
    await playNotificationSound();

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('unhandled rejection 을 만들지 않는다 (void 로 불러도 안전하다)', async () => {
    installAudioContext(() => makeStub('suspended', 'reject'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const unhandled: unknown[] = [];
    const onUnhandled = (event: Event) => unhandled.push(event);
    window.addEventListener('unhandledrejection', onUnhandled);

    // 호출자(NotificationContext)가 실제로 쓰는 형태 — catch 를 붙이지 않는다.
    void playNotificationSound();
    await new Promise(resolve => setTimeout(resolve, 0));

    window.removeEventListener('unhandledrejection', onUnhandled);
    expect(unhandled).toHaveLength(0);
    warn.mockRestore();
  });

  it('AudioContext 가 없는 환경에서는 조용히 false 를 돌려준다', async () => {
    installAudioContext(null);

    expect(isNotificationSoundSupported()).toBe(false);
    await expect(playNotificationSound()).resolves.toBe(false);
  });

  it('AudioContext 를 알림마다 새로 만들지 않는다 (브라우저 상한 소진 방지)', async () => {
    installAudioContext(() => makeStub('running', 'running'));

    await playNotificationSound();
    await playNotificationSound();
    await playNotificationSound();

    expect(created).toHaveLength(1);
  });
});
