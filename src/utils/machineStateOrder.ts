import { MACHINE_STATES, type MachineState } from '@/types';
import { compareByRank } from './tableSorters';

/**
 * 설비 상태 컬럼의 정렬 순서.
 *
 * 상태는 가나다순으로 정렬하면 안 된다. 화면에 보이는 것은 번역된 라벨이라
 * 한국어("고장수리중")와 베트남어("Đang sửa chữa")의 정렬 결과가 서로 달라지고,
 * 어느 쪽도 "무엇을 먼저 봐야 하는가" 를 말해주지 않는다.
 *
 * 그래서 라벨이 아니라 **이 배열의 순서**로 정렬한다. 오름차순을 눌렀을 때
 * 위에 오는 것이 배열 앞쪽이다.
 *
 * ⚠️ `MACHINE_STATES` 의 9개를 모두 담아야 한다. 아래 타입 검사가 빠진 상태를 잡는다.
 */
export const MACHINE_STATE_SORT_ORDER = [
  'BREAKDOWN_REPAIR',    // 고장수리중 — 계획에 없던 정지. 가장 먼저 봐야 한다.
  'INSPECTION',          // 점검중
  'PM_MAINTENANCE',      // PM중
  'TOOL_CHANGE',         // 공구교환
  'PROGRAM_CHANGE',      // 프로그램 교체
  'MODEL_CHANGE',        // 모델교체
  'TEMPORARY_STOP',      // 일시정지
  'PLANNED_STOP',        // 계획정지 — 계획된 정지라 확인 우선순위가 낮다.
  'NORMAL_OPERATION',    // 정상가동 — 볼 일이 없으므로 맨 뒤.
] as const satisfies readonly MachineState[];

/** 상태 컬럼용 antd `sorter`. */
export const compareMachineState = compareByRank(MACHINE_STATE_SORT_ORDER);

/** 나열이 빠진 상태가 없는지 확인한다 (누락되면 그 상태가 조용히 맨 뒤로 밀린다). */
export const MISSING_FROM_SORT_ORDER: readonly MachineState[] = MACHINE_STATES.filter(
  state => !(MACHINE_STATE_SORT_ORDER as readonly string[]).includes(state)
);
