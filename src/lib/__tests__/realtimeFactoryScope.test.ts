import fs from 'fs';
import path from 'path';
import {
  factoryChannelName,
  factoryEqFilter,
  pickRealtimeFilter,
  realtimeFilterOption,
  setCurrentFactoryScope,
  getCurrentFactoryScope,
} from '../realtimeScope';

/**
 * Realtime 공장 범위 — 규칙과 원장.
 *
 * ## 지키려는 명제
 *
 * **Realtime 채널은 예외 없이 공장 이름을 달고, 필터는 한 곳의 규칙에서 나온다.**
 *
 * 경계 자체는 RLS 다(`postgres_changes` 는 구독자마다 정책을 평가한다). 이 검사가 지키는
 * 것은 두 가지다:
 *
 *   1. **broadcast 에서는 토픽 이름이 곧 경계다.** RLS 를 타지 않으므로, 두 공장이 같은
 *      토픽을 쓰면 한쪽 사건이 다른 쪽 클라이언트를 움직인다.
 *   2. **팬아웃.** 필터 없는 구독은 전 공장 변경에 대해 RLS 평가를 유발한 뒤 버린다.
 *      ALT 800 + ALV 350 체제에서 그 비용이 두 배가 된다.
 *
 * ## 왜 원장인가
 *
 * 새 채널은 계속 생긴다. 그리고 새로 생긴 채널이 전역이면 **아무 증상도 없다** — 화면은
 * 정상이고 오류도 없다. 그래서 "고친 것을 세는" 대신 "안 고친 것이 없음을 세는" 검사를 둔다.
 */

describe('realtimeScope — 규칙', () => {
  it('채널 이름에 공장을 싣는다', () => {
    expect(factoryChannelName('machines_changes', 'ALT')).toBe('machines_changes:ALT');
  });

  it('공장이 확정되지 않았으면 이름을 지어내지 않는다', () => {
    // 임의의 코드를 채우면 그 이름이 거짓이 된다. 모른다는 사실을 그대로 적는다.
    expect(factoryChannelName('machines_changes', null)).toBe('machines_changes:unscoped');
  });

  it('공장이 확정되지 않았으면 필터를 걸지 않는다', () => {
    // 여기서 아무 값이나 넣으면 그 순간 **잘못된 공장**을 듣는다. 필터 없음(=RLS 만)이 옳다.
    expect(factoryEqFilter(null)).toBeUndefined();
    expect(factoryEqFilter('f-1')).toBe('factory_id=eq.f-1');
  });

  it('담당 설비 필터가 있으면 그것을 쓴다 — 더 좁기 때문이다', () => {
    // postgres_changes 의 filter 는 조건 **한 개**만 받는다. 그래서 둘을 함께 걸 수 없고,
    // 배정이 공장을 넘지 못하므로(user_machine_assignments 복합 FK) 담당 필터가 더 좁다.
    expect(pickRealtimeFilter('machine_id=in.(a,b)', 'f-1')).toBe('machine_id=in.(a,b)');
  });

  it('담당 설비 필터가 없으면 공장으로 좁힌다', () => {
    expect(pickRealtimeFilter(undefined, 'f-1')).toBe('factory_id=eq.f-1');
  });

  it('둘 다 없으면 필터를 만들지 않는다 (빈 객체를 펼쳐도 안전하다)', () => {
    expect(realtimeFilterOption(undefined, null)).toEqual({});
    expect(realtimeFilterOption(undefined, 'f-1')).toEqual({ filter: 'factory_id=eq.f-1' });
  });

  it('React 밖 발신자용 공장 값은 심고 읽을 수 있다', () => {
    // 한 페이지 로드에 공장은 하나뿐이므로(전환은 전체 페이지 이동) 모듈 값이어도 어긋나지
    // 않는다. 그 근거는 realtimeScope.ts 상단에 적혀 있다.
    setCurrentFactoryScope('ALV');
    expect(getCurrentFactoryScope()).toBe('ALV');
    setCurrentFactoryScope(null);
    expect(getCurrentFactoryScope()).toBeNull();
  });
});

const SRC_ROOT = path.join(process.cwd(), 'src');

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...collectSources(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** `.channel(` 호출이 들어 있는 줄들. */
function channelCalls(source: string): string[] {
  const lines = source.split('\n');
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!/\.channel\(/.test(trimmed)) continue;
    // 규칙 자체를 설명하는 주석은 대상이 아니다.
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    // 호출이 줄바꿈으로 나뉘어 있으면(`supabase.channel(` 다음 줄에 인자) 한 줄만 보고는
    // 인자를 못 본다. 실제로 `systemSettings.ts` 가 그 모양이라 오판했다.
    found.push(lines.slice(i, i + 3).join(' ').replace(/\s+/g, ' ').trim());
  }
  return found;
}

describe('Realtime 채널 원장', () => {
  const files = collectSources(SRC_ROOT).filter(f => !f.endsWith('realtimeScope.ts'));
  const offenders: string[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const line of channelCalls(source)) {
      // 이름을 만드는 방법은 하나로 고정한다. 손으로 `${code}` 를 이어 붙이면 형식이
      // 갈라지고, 발신자와 수신자가 서로 다른 토픽을 쓰게 된다(broadcast 에서는 그것이
      // 곧 "재조회가 영원히 오지 않는다"는 뜻이다).
      if (!/factoryChannelName\(/.test(line)) {
        offenders.push(`${path.relative(SRC_ROOT, file)}: ${line.trim()}`);
      }
    }
  }

  it('채널 호출을 하나 이상 찾는다', () => {
    // 정규식이 깨져 0개를 찾으면 아래 검사가 공허하게 통과한다.
    const total = files.reduce(
      (sum, f) => sum + channelCalls(fs.readFileSync(f, 'utf8')).length,
      0
    );
    expect(total).toBeGreaterThan(5);
  });

  it('모든 채널이 factoryChannelName 을 거친다', () => {
    expect(offenders).toEqual([]);
  });
});
