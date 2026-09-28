import type { ForecastSnapshotMachine } from '@/types/forecast';
import type { ModelProcessRequirement } from '@/lib/forecast/requiredMachines';
import { recommendLayout, type MachinePosition } from '../recommendLayout';

/**
 * 동선(작업자 이동선) 기준 추천 — 사용자 확정 규칙 2026-09-28.
 *   · 빨간 선 = 동선, 양쪽 두 열이 마주본다. 동선은 가로 통로에서 끊긴다.
 *   · 한 동선 = 한 공정 최우선. 둘이면 좌우(한쪽 열씩) 우선, 다음 위·아래 끝 블록. 중간 끼워넣기 금지.
 *   · 동선 규칙 > 변경 최소. 한쪽 열을 통째로 바꾸는 초과는 열 크기의 절반 미만까지.
 *   · 같은 모델은 옆 동선끼리. 섞인 열의 홀로 다른 설비는 바꿀 때 그 열의 모델·공정으로.
 */
const W = 104, H = 62, PX = 116, PY = 72;
type Proc = 'CNC1' | 'CNC2';
/** 동선 순번 n 의 왼쪽 열은 x = 2n, 오른쪽 열은 2n+1 (마주봄). 옆 동선과는 등이 맞닿는다. */
const pos = (walkway: number, side: 'L' | 'R', row: number): MachinePosition => ({
  building: 'B', x: (walkway * 2 + (side === 'R' ? 1 : 0)) * PX, y: row * PY, width: W, height: H,
  walkway: `B-${String(walkway).padStart(2, '0')}-U`, side,
});
const pid = (model: string, process: Proc) => `${model}-${process}`;
const req = (model: string, process: Proc, required: number | null, current: number, status: ModelProcessRequirement['status']): ModelProcessRequirement => ({
  key: `${model}:${process}`, forecastModel: model, dbModel: { id: model, name: model }, process, processId: pid(model, process),
  tactTimeSeconds: 600, dailyCapacity: 100, peakQuantity: required ? required * 100 : 0, peakDate: null,
  required, current, gap: required === null ? null : required - current, status, warnings: [],
});

interface Column { walkway: number; side: 'L' | 'R'; cells: Array<[string, Proc] | null> }
/** 열 단위로 설비를 깐다. 설비 이름은 `<동선>-<쪽>-<행>` 이라 결과에서 위치를 바로 읽을 수 있다. */
function build(columns: Column[]) {
  const machines: ForecastSnapshotMachine[] = [];
  const positions = new Map<string, MachinePosition>();
  const processNames = new Map<string, string>();
  for (const c of columns) {
    c.cells.forEach((cell, row) => {
      const name = `${String(c.walkway).padStart(2, '0')}${c.side}${String(row).padStart(2, '0')}`;
      machines.push({ id: name, name, location: '', isActive: true, modelId: cell ? cell[0] : null, processId: cell ? pid(cell[0], cell[1]) : null });
      positions.set(name, pos(c.walkway, c.side, row));
      if (cell) processNames.set(pid(cell[0], cell[1]), cell[1]);
    });
  }
  return { machines, positions, processNames };
}
const fill = (n: number, model: string, process: Proc): Array<[string, Proc]> => Array.from({ length: n }, () => [model, process]);
const run = (columns: Column[], requirements: ModelProcessRequirement[]) => {
  const { machines, positions, processNames } = build(columns);
  for (const r of requirements) if (r.processId) processNames.set(r.processId, r.process);
  return recommendLayout({ requirements, machines, positions, processNames, locked: new Set(), nextWeekDemands: [] });
};
const movedTo = (result: ReturnType<typeof recommendLayout>, model: string) =>
  result.moves.filter(mv => mv.to.modelId === model).map(mv => mv.machineName).sort();

describe('동선 기준 추천', () => {
  it('등이 맞닿은 옆 열이 가까워도 라인 한가운데에 끼워 넣지 않는다 (W40 CNC-613 사례)', () => {
    // 동선 7: L=3대(M3-C2), R=9대 M3-C2 인데 가운데(행 4) 한 대만 DM3(수요 0).
    // 동선 8: L=B6-C1 6대(1대 부족) — 동선 7 의 R 열과 등이 맞닿아 거리로는 가장 가깝다.
    // 동선 12: 멀리 떨어진 수요 0 모델 Q 열 6대.
    const m3 = fill(9, 'M3', 'CNC2') as Array<[string, Proc] | null>;
    m3[4] = ['DM3', 'CNC2'];
    const result = run([
      { walkway: 7, side: 'L', cells: fill(3, 'M3', 'CNC2') },
      { walkway: 7, side: 'R', cells: m3 },
      { walkway: 8, side: 'L', cells: fill(6, 'B6', 'CNC1') },
      { walkway: 12, side: 'L', cells: fill(6, 'Q', 'CNC1') },
    ], [req('B6', 'CNC1', 7, 6, 'shortage'), req('M3', 'CNC2', 11, 11, 'ok'), req('DM3', 'CNC2', 0, 1, 'zero_demand'), req('Q', 'CNC1', 0, 6, 'zero_demand')]);
    expect(movedTo(result, 'B6')).toHaveLength(1);
    expect(movedTo(result, 'B6')[0]).not.toBe('07R04');       // 라인 중간의 DM3 를 B6 로 쓰지 않는다
    expect(movedTo(result, 'B6')[0].startsWith('12L')).toBe(true);
  });

  it('열 끝에 있는 홀로 다른 설비도 다른 모델의 시작점으로 쓰지 않는다 (끝이라 끼워넣기 검사로는 못 막는 경우)', () => {
    // 동선 7 R 열: 맨 위(행 0)만 DM3(수요 0), 나머지 M3-C2. 옆 동선 8 에 B6-C1 이 1대 부족.
    // 먼 동선 12 의 Q 열도 수요 0 이고, 맞은편이 다른 공정이라 '한 동선 한 공정' 점수는 같다.
    // 거리로는 동선 7 이 가깝지만, DM3 는 그 열(M3-C2)로만 바꿀 수 있다.
    const m3 = fill(9, 'M3', 'CNC2') as Array<[string, Proc] | null>;
    m3[0] = ['DM3', 'CNC2'];
    const result = run([
      { walkway: 7, side: 'L', cells: fill(3, 'M3', 'CNC2') },
      { walkway: 7, side: 'R', cells: m3 },
      { walkway: 8, side: 'L', cells: fill(6, 'B6', 'CNC1') },
      { walkway: 12, side: 'L', cells: fill(6, 'Q', 'CNC1') },
      { walkway: 12, side: 'R', cells: fill(6, 'Z', 'CNC2') },
    ], [req('B6', 'CNC1', 7, 6, 'shortage'), req('M3', 'CNC2', 11, 11, 'ok'), req('DM3', 'CNC2', 0, 1, 'zero_demand'),
      req('Q', 'CNC1', 0, 6, 'zero_demand'), req('Z', 'CNC2', 6, 6, 'ok')]);
    expect(movedTo(result, 'B6')).toHaveLength(1);
    expect(movedTo(result, 'B6')[0].startsWith('12L')).toBe(true);
  });

  it('섞인 열의 홀로 다른 설비는 그 열의 모델·공정으로만 바꾼다', () => {
    const m3 = fill(9, 'M3', 'CNC2') as Array<[string, Proc] | null>;
    m3[4] = ['DM3', 'CNC2'];
    const result = run([{ walkway: 7, side: 'R', cells: m3 }], [req('M3', 'CNC2', 9, 8, 'shortage'), req('DM3', 'CNC2', 0, 1, 'zero_demand')]);
    expect(result.moves.map(mv => [mv.machineName, mv.to.modelId, mv.to.processId])).toEqual([['07R04', 'M3', pid('M3', 'CNC2')]]);
  });

  it('필요가 열의 절반을 넘으면 한쪽 열을 통째로 바꾼다 (5대 필요, 8대 열 → 8대)', () => {
    const result = run([
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 4, side: 'L', cells: fill(8, 'Y', 'CNC1') },
    ], [req('X', 'CNC1', 13, 8, 'shortage'), req('Y', 'CNC1', 0, 8, 'zero_demand')]);
    expect(movedTo(result, 'X')).toEqual(Array.from({ length: 8 }, (_, i) => `04L${String(i).padStart(2, '0')}`));
  });

  it('열 양 끝이 막혀 있으면 가운데를 쓰지 않는다 — 부족으로 남긴다', () => {
    // 동선 4 L 열: 맨 위·맨 아래는 가동 중인 Z(여유 없음), 가운데 6대만 수요 0 인 Y.
    const cells = [['Z', 'CNC1'], ...fill(6, 'Y', 'CNC1'), ['Z', 'CNC1']] as Array<[string, Proc]>;
    const result = run([
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 4, side: 'L', cells },
    ], [req('X', 'CNC1', 11, 8, 'shortage'), req('Y', 'CNC1', 0, 6, 'zero_demand'), req('Z', 'CNC1', 2, 2, 'ok')]);
    expect(result.moves).toEqual([]);
    expect(result.unresolved).toEqual([{ modelId: 'X', processId: pid('X', 'CNC1'), remaining: 3 }]);
  });

  it('필요가 열의 절반 이하면 열 끝에서 필요한 만큼만 연속으로 바꾼다 (3대 필요 → 끝 3대)', () => {
    const result = run([
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 4, side: 'L', cells: fill(8, 'Y', 'CNC1') },
    ], [req('X', 'CNC1', 11, 8, 'shortage'), req('Y', 'CNC1', 0, 8, 'zero_demand')]);
    const rows = movedTo(result, 'X').map(n => Number(n.slice(3))).sort((a, b) => a - b);
    expect(rows).toHaveLength(3);
    expect(rows[2] - rows[0]).toBe(2);                       // 연속
    expect(rows[0] === 0 || rows[2] === 7).toBe(true);       // 끝에 붙음 — 중간 끼워넣기 금지
  });

  it('한쪽 열 통째가 다른 열의 딱 맞는 끝 블록보다 우선한다 (초과가 절반 미만이면)', () => {
    // X 가 5대 부족, 기존 X 는 동선 3. 같은 거리의 후보 둘:
    //   동선 2 L: Y 8대 — 통째로 바꾸면 3대 초과(8의 절반 미만)이지만 열이 한 모델로 남는다
    //   동선 4 L: Y 10대 — 끝에서 5대면 딱 맞지만 열이 위·아래 두 모델이 된다
    const result = run([
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 2, side: 'L', cells: fill(8, 'Y', 'CNC1') },
      { walkway: 2, side: 'R', cells: fill(5, 'V', 'CNC1') },   // 두 동선의 '남는 다른 모델' 수를 5대로 맞춘다
      { walkway: 4, side: 'L', cells: fill(10, 'Y', 'CNC1') },
    ], [req('X', 'CNC1', 13, 8, 'shortage'), req('Y', 'CNC1', 0, 18, 'zero_demand'), req('V', 'CNC1', 5, 5, 'ok')]);
    expect(movedTo(result, 'X')).toEqual(Array.from({ length: 8 }, (_, i) => `02L${String(i).padStart(2, '0')}`));
  });

  it('통째 초과가 다른 모델의 부족을 만들면 초과하지 않는다 (여유가 남을 때만 초과)', () => {
    // X 5대·W 3대 부족, 쓸 수 있는 여유는 Y 한 열 8대뿐. X 가 열을 통째(8대)로 가져가면 W 가 3대 부족해진다.
    const result = run([
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 4, side: 'L', cells: fill(8, 'Y', 'CNC1') },
      { walkway: 5, side: 'L', cells: fill(4, 'W', 'CNC1') },
    ], [req('X', 'CNC1', 13, 8, 'shortage'), req('W', 'CNC1', 7, 4, 'shortage'), req('Y', 'CNC1', 0, 8, 'zero_demand')]);
    expect(movedTo(result, 'X')).toHaveLength(5);
    expect(movedTo(result, 'W')).toHaveLength(3);
    expect(result.unresolved).toEqual([]);
  });

  it('여유 한도보다 큰 열은 통째로 가져오지 않는다 (여유 3대뿐이면 3대까지만)', () => {
    const result = run([
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 4, side: 'L', cells: fill(8, 'Y', 'CNC1') },
    ], [req('X', 'CNC1', 14, 8, 'shortage'), req('Y', 'CNC1', 5, 8, 'surplus')]);
    expect(movedTo(result, 'X')).toHaveLength(3);
    expect(result.unresolved).toEqual([{ modelId: 'X', processId: pid('X', 'CNC1'), remaining: 3 }]);
  });

  it('한 동선 = 한 공정: 더 가까운 동선보다 맞은편이 같은 공정인 동선을 먼저 쓴다', () => {
    // X-CNC2 가 4대 부족하고 기존 X 는 동선 7 에 있다. 후보 열 둘은 같은 조건(수요 0, 4대).
    //   동선 6 L: 맞은편 Z-CNC1(다른 공정) — X 와 거리 1
    //   동선 5 L: 맞은편 W-CNC2(같은 공정) — X 와 거리 2
    const result = run([
      { walkway: 5, side: 'L', cells: fill(4, 'Q', 'CNC1') },
      { walkway: 5, side: 'R', cells: fill(4, 'W', 'CNC2') },
      { walkway: 6, side: 'L', cells: fill(4, 'P', 'CNC1') },
      { walkway: 6, side: 'R', cells: fill(4, 'Z', 'CNC1') },
      { walkway: 7, side: 'L', cells: fill(4, 'X', 'CNC2') },
    ], [req('X', 'CNC2', 8, 4, 'shortage'), req('Q', 'CNC1', 0, 4, 'zero_demand'), req('P', 'CNC1', 0, 4, 'zero_demand'),
      req('W', 'CNC2', 4, 4, 'ok'), req('Z', 'CNC1', 4, 4, 'ok')]);
    expect(movedTo(result, 'X')).toEqual(['05L00', '05L01', '05L02', '05L03']);
  });

  it('좌우 한쪽 열을 먼저: 양쪽에서 반씩이 아니라 한쪽 열을 통째로', () => {
    const result = run([
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 4, side: 'L', cells: fill(8, 'Y', 'CNC1') },
      { walkway: 4, side: 'R', cells: fill(8, 'Y', 'CNC1') },
    ], [req('X', 'CNC1', 16, 8, 'shortage'), req('Y', 'CNC1', 0, 16, 'zero_demand')]);
    const sides = new Set(movedTo(result, 'X').map(n => n.slice(0, 3)));
    expect(movedTo(result, 'X')).toHaveLength(8);
    expect(sides.size).toBe(1);
  });

  it('같은 모델은 옆 동선부터: 멀리 있는 같은 조건의 열보다 옆 동선의 열', () => {
    // 기존 X 는 동선 9. 후보는 옆 동선 8 과 먼 동선 2 — 이름 순서로는 동선 2 가 먼저라 거리 규칙이 있어야 8 을 고른다.
    const result = run([
      { walkway: 9, side: 'L', cells: fill(6, 'X', 'CNC1') },
      { walkway: 9, side: 'R', cells: fill(6, 'X', 'CNC1') },
      { walkway: 8, side: 'L', cells: fill(6, 'P', 'CNC1') },
      { walkway: 2, side: 'L', cells: fill(6, 'Q', 'CNC1') },
    ], [req('X', 'CNC1', 18, 12, 'shortage'), req('P', 'CNC1', 0, 6, 'zero_demand'), req('Q', 'CNC1', 0, 6, 'zero_demand')]);
    expect(movedTo(result, 'X').every(n => n.startsWith('08L'))).toBe(true);
  });
});
