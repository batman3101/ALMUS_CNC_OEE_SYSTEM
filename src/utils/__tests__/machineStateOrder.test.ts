import { MACHINE_STATES } from '@/types';
import {
  MACHINE_STATE_SORT_ORDER,
  MISSING_FROM_SORT_ORDER,
  compareMachineState
} from '../machineStateOrder';

describe('machineStateOrder', () => {
  it('DB 의 9개 상태를 하나도 빠뜨리지 않는다', () => {
    // 빠진 상태는 조용히 맨 뒤로 밀린다 — 정렬이 "되긴 되는데 이상한" 상태가 된다.
    expect(MISSING_FROM_SORT_ORDER).toEqual([]);
    expect(MACHINE_STATE_SORT_ORDER).toHaveLength(MACHINE_STATES.length);
  });

  it('중복이 없다', () => {
    expect(new Set(MACHINE_STATE_SORT_ORDER).size).toBe(MACHINE_STATE_SORT_ORDER.length);
  });

  it('오름차순 첫 화면은 손봐야 할 설비다', () => {
    const rows = [
      { s: 'NORMAL_OPERATION' },
      { s: 'PLANNED_STOP' },
      { s: 'BREAKDOWN_REPAIR' }
    ];
    const ascend = [...rows].sort((a, b) => compareMachineState(a.s, b.s, 'ascend'));
    expect(ascend[0].s).toBe('BREAKDOWN_REPAIR');
  });

  it('알 수 없는 상태는 방향과 무관하게 맨 뒤', () => {
    const rows = [{ s: 'NOT_A_STATE' }, { s: 'NORMAL_OPERATION' }, { s: 'BREAKDOWN_REPAIR' }];
    for (const order of ['ascend', 'descend'] as const) {
      const sorted = [...rows].sort((a, b) => {
        const r = compareMachineState(a.s, b.s, order);
        return order === 'descend' ? -r : r;
      });
      expect(sorted[sorted.length - 1].s).toBe('NOT_A_STATE');
    }
  });
});
