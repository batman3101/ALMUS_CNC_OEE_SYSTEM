'use client';

/**
 * 알림음 재생. **자산 파일 없이** Web Audio 로 짧은 두 음을 합성한다.
 *
 * ## 왜 mp3 를 넣지 않았나
 *
 * 알림음은 "삐-빅" 두 음이면 충분하고, 그건 오실레이터 두 번으로 만들어진다. 바이너리를
 * 저장소에 넣으면 라이선스·용량·캐시 무효화를 계속 관리해야 하는데, 그 비용을 낼 이유가
 * 이 소리에는 없다. 자산이 필요해지는 시점은 "공장이 구분해서 듣는 여러 소리"가 생길
 * 때이고, 지금은 소리가 하나다.
 *
 * ## 자동재생 정책
 *
 * 브라우저는 사용자 제스처 없이 시작된 오디오를 막는다. 알림은 정의상 제스처 없이 오므로
 * **막히는 것이 정상 경로**다. 그래서 이 모듈은
 *
 * - 막혔을 때 예외를 던지지 않고 `false` 를 돌려준다 (호출자가 `catch` 를 잊어도 unhandled
 *   rejection 이 생기지 않는다),
 * - 같은 이유의 경고를 **한 번만** 남긴다. 알림마다 콘솔에 찍으면 진짜 오류가 묻힌다.
 *
 * 사용자가 페이지 어딘가를 한 번 클릭하면 `AudioContext` 는 스스로 `running` 이 되고 그
 * 뒤로는 소리가 난다. 관리자 대시보드는 클릭 없이 12시간 방치되는 화면이 아니다.
 */

/** 합성 파라미터. 짧고(0.35초 이내) 낮은 음량으로 — 현장에서 거슬리면 첫날 꺼진다. */
const TONE_HZ = [880, 1_174.66] as const; // A5 → D6
const TONE_SECONDS = 0.12;
const TONE_GAP_SECONDS = 0.06;
const PEAK_GAIN = 0.15;

type AudioContextConstructor = new () => AudioContext;

/**
 * `AudioContext` 는 만들 때마다 실제 오디오 장치를 잡는다. 알림마다 새로 만들면 브라우저
 * 상한(대개 6개)에 걸려 그 뒤로는 아무 소리도 안 난다. 하나를 재사용한다.
 */
let sharedContext: AudioContext | null = null;
let blockedWarningLogged = false;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as Window & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** 오디오를 쓸 수 있는 환경인가(브라우저 지원 여부만 본다 — 설정과는 무관하다). */
export function isNotificationSoundSupported(): boolean {
  return getAudioContextConstructor() !== null;
}

function acquireContext(): AudioContext | null {
  if (sharedContext && sharedContext.state !== 'closed') return sharedContext;
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return null;
  try {
    sharedContext = new Ctor();
    return sharedContext;
  } catch {
    // 컨텍스트 생성 자체가 막히는 환경(오디오 장치 없음 등). 알림은 계속 떠야 하므로
    // 조용히 포기한다.
    sharedContext = null;
    return null;
  }
}

function warnBlockedOnce(reason: string): void {
  if (blockedWarningLogged) return;
  blockedWarningLogged = true;
  console.warn(`🔇 알림음이 브라우저에 막혔습니다(${reason}). 화면을 한 번 클릭하면 재생됩니다.`);
}

/**
 * 알림음을 재생한다.
 *
 * @returns 실제로 소리가 시작됐으면 `true`. 미지원·자동재생 차단·합성 실패는 `false` 이며
 *          **예외를 던지지 않는다.** 호출자는 `void playNotificationSound()` 로 불러도 안전하다.
 */
export async function playNotificationSound(): Promise<boolean> {
  const context = acquireContext();
  if (!context) return false;

  if (context.state === 'suspended') {
    try {
      await context.resume();
    } catch {
      warnBlockedOnce('resume 거부');
      return false;
    }
  }

  // resume() 이 성공했다고 상태가 반드시 running 이 되는 것은 아니다(제스처 전에는 그대로
  // suspended 로 남는 브라우저가 있다). 상태를 다시 본다.
  if (context.state !== 'running') {
    warnBlockedOnce('자동재생 정책');
    return false;
  }

  try {
    const startAt = context.currentTime;
    TONE_HZ.forEach((frequency, index) => {
      const toneStart = startAt + index * (TONE_SECONDS + TONE_GAP_SECONDS);
      const toneEnd = toneStart + TONE_SECONDS;

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, toneStart);

      // 딱딱한 on/off 는 '틱' 하는 클릭음을 만든다. 짧은 페이드로 감싼다.
      gain.gain.setValueAtTime(0, toneStart);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, toneStart + 0.01);
      gain.gain.linearRampToValueAtTime(0, toneEnd);

      oscillator.connect(gain);
      gain.connect(context.destination);
      // 노드를 끊지 않으면 재생이 끝나도 그래프에 남는다. 알림마다 쌓이므로 정리한다.
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(toneStart);
      oscillator.stop(toneEnd);
    });
    return true;
  } catch (error) {
    console.warn('🔇 알림음 합성 실패:', error);
    return false;
  }
}

/**
 * 테스트 전용. 모듈 수준 캐시(공유 컨텍스트·1회 경고 플래그)를 비운다.
 *
 * 프로덕션 코드는 부르지 않는다 — 공유 컨텍스트를 버리면 다음 재생이 새 오디오 장치를
 * 잡는다.
 */
export function __resetNotificationSoundForTests(): void {
  sharedContext = null;
  blockedWarningLogged = false;
}
