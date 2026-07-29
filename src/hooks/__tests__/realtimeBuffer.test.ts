// applyRealtimeMachineLog 를 REAL 로 쓰려고 useRealtimeData 를 import 하는데, 그 모듈이
// Supabase 클라이언트를 끌고 온다. 테스트 대상은 순수 병합 규칙이므로 클라이언트만 비운다.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/authFetch', () => ({
  authFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

import { replayBufferedUpdates } from '../realtimeBuffer';
import { applyRealtimeMachineLog } from '../useRealtimeData';
import type { MachineLog } from '@/types';

/**
 * Codex 감사 2026-07-29 #8 회귀 검사.
 *
 * 결함의 정확한 모양: 구독이 스냅샷 조회보다 먼저 열리므로, 스냅샷이 도는 동안 이벤트가
 * 먼저 도착해 상태에 반영될 수 있다. 그런데 스냅샷 적용은 배열을 **통째로 교체**하므로
 * 그 이벤트가 지워졌다.
 *
 * 그래서 이 테스트는 "버퍼가 존재한다" 가 아니라 **"스냅샷이 이벤트를 덮지 않는다"** 를
 * 단언한다. 순서를 뒤집으면(먼저 재생하고 스냅샷을 덮으면) 반드시 실패한다.
 */

const log = (id: string, state: string, endTime: string | null = null): MachineLog => ({
  log_id: id,
  machine_id: 'm-1',
  state,
  start_time: '2026-07-29T01:00:00.000Z',
  end_time: endTime,
} as MachineLog);

interface TestState {
  machineLogs: MachineLog[];
}

describe('replayBufferedUpdates', () => {
  it('스냅샷 조회 중 도착한 INSERT 가 스냅샷 교체에 지워지지 않는다', () => {
    // 스냅샷은 SELECT 시점의 상태라 그 이후 커밋된 log-2 를 담고 있지 않다.
    const snapshot: TestState = { machineLogs: [log('log-1', 'NORMAL_OPERATION')] };

    const buffered = [
      (s: TestState): TestState => ({
        ...s,
        machineLogs: applyRealtimeMachineLog(s.machineLogs, 'INSERT', log('log-2', 'BREAKDOWN_REPAIR')),
      }),
    ];

    const result = replayBufferedUpdates(snapshot, buffered);

    expect(result.machineLogs.map(l => l.log_id).sort()).toEqual(['log-1', 'log-2']);
  });

  it('버퍼는 도착 순서대로 재생된다 — 나중 갱신이 이긴다', () => {
    const snapshot: TestState = { machineLogs: [] };

    const buffered = [
      (s: TestState): TestState => ({
        ...s,
        machineLogs: applyRealtimeMachineLog(s.machineLogs, 'INSERT', log('log-9', 'BREAKDOWN_REPAIR')),
      }),
      (s: TestState): TestState => ({
        ...s,
        machineLogs: applyRealtimeMachineLog(
          s.machineLogs, 'UPDATE', log('log-9', 'BREAKDOWN_REPAIR', '2026-07-29T02:00:00.000Z'), 'log-9',
        ),
      }),
    ];

    const result = replayBufferedUpdates(snapshot, buffered);

    expect(result.machineLogs).toHaveLength(1);
    // 순서가 뒤집히면 end_time 이 null 로 남아 "아직 비가동 중" 으로 보인다.
    expect(result.machineLogs[0].end_time).toBe('2026-07-29T02:00:00.000Z');
  });

  it('스냅샷에 이미 담긴 이벤트를 다시 재생해도 결과가 같다 (멱등)', () => {
    // 이 성질 덕분에 "스냅샷에 반영됐는지" 를 따질 필요 없이 버퍼를 전부 재생할 수 있다.
    const alreadyInSnapshot = log('log-3', 'MAINTENANCE');
    const snapshot: TestState = { machineLogs: [log('log-1', 'NORMAL_OPERATION'), alreadyInSnapshot] };

    const buffered = [
      (s: TestState): TestState => ({
        ...s,
        machineLogs: applyRealtimeMachineLog(s.machineLogs, 'INSERT', alreadyInSnapshot),
      }),
    ];

    const result = replayBufferedUpdates(snapshot, buffered);

    expect(result.machineLogs.filter(l => l.log_id === 'log-3')).toHaveLength(1);
  });

  it('버퍼가 비어 있으면 스냅샷을 그대로 돌려준다', () => {
    const snapshot: TestState = { machineLogs: [log('log-1', 'NORMAL_OPERATION')] };

    expect(replayBufferedUpdates(snapshot, [])).toBe(snapshot);
  });

  it('버퍼에 담긴 DELETE 도 스냅샷 위에 적용된다', () => {
    // 스냅샷 SELECT 이후 삭제된 행은 스냅샷에 남아 있다 — 재생하지 않으면 유령으로 남는다.
    const snapshot: TestState = {
      machineLogs: [log('log-1', 'NORMAL_OPERATION'), log('log-2', 'BREAKDOWN_REPAIR')],
    };

    const buffered = [
      (s: TestState): TestState => ({
        ...s,
        machineLogs: applyRealtimeMachineLog(s.machineLogs, 'DELETE', undefined, 'log-2'),
      }),
    ];

    const result = replayBufferedUpdates(snapshot, buffered);

    expect(result.machineLogs.map(l => l.log_id)).toEqual(['log-1']);
  });
});
