import type { ForecastSnapshotMachine } from '@/types/forecast';
import type { ModelProcessRequirement } from '@/lib/forecast/requiredMachines';
import { recommendLayout, type MachinePosition } from '../recommendLayout';

/**
 * 동선(작업자 이동선) 기준 추천 — 사용자 확정 규칙 2026-09-28.
 *   · 빨간 선 = 동선, 양쪽 두 열이 마주본다. 동선은 가로 통로에서 끊긴다.
 *   · 한 동선 = 한 공정 최우선. 둘이면 좌우(한쪽 열씩) 우선, 다음 위·아래 끝 블록. 중간 끼워넣기 금지.
 *   · 동선 규칙 > 변경 최소. 한쪽 열을 통째로 바꾸는 초과는 열 크기의 절반 미만까지.
 *   · 같은 모델은 옆 동선끼리. 섞인 열의 홀로 다른 설비는 바꿀 때 그 열의 모델·공정으로.
 *   · 섬 금지: 새 블록은 같은 모델·공정 무리에 붙어야 한다(같은 열 이어서·마주본 열·등 맞닿은 옆 열). 붙일 자리가 없으면
 *     부족 알림으로 남긴다. 무리가 없는 새 모델은 한 곳에서 시작해 그 무리로 키운다. 열은 최대 2조각. 연쇄 이동 없음.
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


// 배치 규약: 동선 n 의 L·R 열이 마주보고, 동선 n 의 R 열과 동선 n+1 의 L 열은 등이 맞닿은 옆 열이다.
describe('동선 기준 추천', () => {
  it('라인 한가운데의 홀로 다른 설비를 다른 모델로 쓰지 않는다 — 붙일 자리가 없으면 부족 알림 (W40 CNC-613 사례)', () => {
    // 동선 7 R 열: M3-C2 9대 중 가운데(행 4)만 DM3(수요 0). 동선 8 L 의 B6-C1 이 1대 부족하고,
    // 동선 7 R 열은 그 B6 열과 등이 맞닿아 있다. 먼 동선 12 의 Q 는 B6 무리에 붙지 않는다.
    const m3 = fill(9, 'M3', 'CNC2') as Array<[string, Proc] | null>;
    m3[4] = ['DM3', 'CNC2'];
    const result = run([
      { walkway: 7, side: 'L', cells: fill(3, 'M3', 'CNC2') },
      { walkway: 7, side: 'R', cells: m3 },
      { walkway: 8, side: 'L', cells: fill(6, 'B6', 'CNC1') },
      { walkway: 12, side: 'L', cells: fill(6, 'Q', 'CNC1') },
    ], [req('B6', 'CNC1', 7, 6, 'shortage'), req('M3', 'CNC2', 11, 11, 'ok'), req('DM3', 'CNC2', 0, 1, 'zero_demand'), req('Q', 'CNC1', 0, 6, 'zero_demand')]);
    expect(result.moves).toEqual([]);
    expect(result.unresolved).toEqual([{ modelId: 'B6', processId: pid('B6', 'CNC1'), remaining: 1 }]);
  });

  it('열 끝에 있는 홀로 다른 설비도 다른 모델로 쓰지 않는다 (끝이라 끼워넣기 검사로는 못 막는 경우)', () => {
    // DM3 가 동선 7 R 열 맨 위. B6 무리(동선 8 L)와 등이 맞닿아 붙을 수 있지만, DM3 는 그 열(M3-C2)로만 바꾼다.
    const m3 = fill(9, 'M3', 'CNC2') as Array<[string, Proc] | null>;
    m3[0] = ['DM3', 'CNC2'];
    const result = run([
      { walkway: 7, side: 'L', cells: fill(3, 'M3', 'CNC2') },
      { walkway: 7, side: 'R', cells: m3 },
      { walkway: 8, side: 'L', cells: fill(6, 'B6', 'CNC1') },
    ], [req('B6', 'CNC1', 7, 6, 'shortage'), req('M3', 'CNC2', 11, 11, 'ok'), req('DM3', 'CNC2', 0, 1, 'zero_demand')]);
    expect(movedTo(result, 'B6')).toEqual([]);
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
      { walkway: 3, side: 'R', cells: fill(8, 'Y', 'CNC1') },
    ], [req('X', 'CNC1', 13, 8, 'shortage'), req('Y', 'CNC1', 0, 8, 'zero_demand')]);
    expect(movedTo(result, 'X')).toEqual(Array.from({ length: 8 }, (_, i) => `03R${String(i).padStart(2, '0')}`));
  });

  it('열 양 끝이 막혀 있으면 가운데를 쓰지 않는다 — 부족으로 남긴다', () => {
    // 이미 Z|Y×6|Z 세 조각인 열. 가운데 6대를 통째로 바꿔도 조각 수는 그대로지만, 끝에 닿지 않는 끼워넣기다.
    const cells = [['Z', 'CNC1'], ...fill(6, 'Y', 'CNC1'), ['Z', 'CNC1']] as Array<[string, Proc]>;
    const result = run([
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 3, side: 'R', cells },
    ], [req('X', 'CNC1', 14, 8, 'shortage'), req('Y', 'CNC1', 0, 6, 'zero_demand'), req('Z', 'CNC1', 2, 2, 'ok')]);
    expect(result.moves).toEqual([]);
    expect(result.unresolved).toEqual([{ modelId: 'X', processId: pid('X', 'CNC1'), remaining: 6 }]);
  });

  it('필요가 열의 절반 이하면 열 끝에서 필요한 만큼만 연속으로 바꾼다 (3대 필요 → 끝 3대)', () => {
    const result = run([
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 3, side: 'R', cells: fill(8, 'Y', 'CNC1') },
    ], [req('X', 'CNC1', 11, 8, 'shortage'), req('Y', 'CNC1', 0, 8, 'zero_demand')]);
    const rows = movedTo(result, 'X').map(n => Number(n.slice(3))).sort((a, b) => a - b);
    expect(rows).toHaveLength(3);
    expect(rows[2] - rows[0]).toBe(2);
    expect(rows[0] === 0 || rows[2] === 7).toBe(true);
  });

  it('한쪽 열 통째가 다른 열의 딱 맞는 끝 블록보다 우선한다 (초과가 절반 미만이면)', () => {
    // X(동선 3 L)가 5대 부족. 붙을 수 있는 후보 둘:
    //   동선 2 R(등 맞닿음): Y 8대 — 통째로 바꾸면 3대 초과지만 열이 한 모델로 남는다
    //   동선 3 R(마주봄): Y 10대 — 끝 5대면 딱 맞지만 열이 위·아래 두 모델이 된다
    const result = run([
      { walkway: 2, side: 'L', cells: fill(5, 'V', 'CNC1') },   // 두 동선의 '남는 다른 모델' 수를 5대로 맞춘다
      { walkway: 2, side: 'R', cells: fill(8, 'Y', 'CNC1') },
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 3, side: 'R', cells: fill(10, 'Y', 'CNC1') },
    ], [req('X', 'CNC1', 13, 8, 'shortage'), req('Y', 'CNC1', 0, 18, 'zero_demand'), req('V', 'CNC1', 5, 5, 'ok')]);
    expect(movedTo(result, 'X')).toEqual(Array.from({ length: 8 }, (_, i) => `02R${String(i).padStart(2, '0')}`));
  });

  it('통째 초과가 다른 모델의 부족을 만들면 초과하지 않는다 (여유가 남을 때만 초과)', () => {
    // X 5대·W 3대 부족, 여유는 Y 한 열 8대(동선 3 R)뿐. X 는 마주봐서, W(동선 4 L)는 등이 맞닿아 그 열에 붙는다.
    const result = run([
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 3, side: 'R', cells: fill(8, 'Y', 'CNC1') },
      { walkway: 4, side: 'L', cells: fill(8, 'W', 'CNC1') },
    ], [req('X', 'CNC1', 13, 8, 'shortage'), req('W', 'CNC1', 11, 8, 'shortage'), req('Y', 'CNC1', 0, 8, 'zero_demand')]);
    expect(movedTo(result, 'X')).toHaveLength(5);
    expect(movedTo(result, 'W')).toHaveLength(3);
    expect(result.unresolved).toEqual([]);
  });

  it('여유 한도보다 큰 열은 통째로 가져오지 않는다 (여유 3대뿐이면 3대까지만)', () => {
    const result = run([
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 3, side: 'R', cells: fill(8, 'Y', 'CNC1') },
    ], [req('X', 'CNC1', 14, 8, 'shortage'), req('Y', 'CNC1', 5, 8, 'surplus')]);
    expect(movedTo(result, 'X')).toHaveLength(3);
    expect(result.unresolved).toEqual([{ modelId: 'X', processId: pid('X', 'CNC1'), remaining: 3 }]);
  });

  it('한 동선 = 한 공정: 붙을 수 있는 열 중 맞은편이 같은 공정인 열을 먼저 쓴다', () => {
    // X-CNC2(동선 7 L)가 4대 부족. 붙을 수 있는 후보 둘(같은 조건, 수요 0, 4대):
    //   동선 6 R(등 맞닿음): 그 동선의 맞은편 Z 는 CNC1 — 이름 순서로는 이쪽이 먼저
    //   동선 7 R(마주봄): 맞은편이 X-CNC2 — 동선 전체가 CNC2 가 된다
    const result = run([
      { walkway: 6, side: 'L', cells: fill(4, 'Z', 'CNC1') },
      { walkway: 6, side: 'R', cells: fill(4, 'P', 'CNC1') },
      { walkway: 7, side: 'L', cells: fill(4, 'X', 'CNC2') },
      { walkway: 7, side: 'R', cells: fill(4, 'Q', 'CNC1') },
    ], [req('X', 'CNC2', 8, 4, 'shortage'), req('Q', 'CNC1', 0, 4, 'zero_demand'), req('P', 'CNC1', 0, 4, 'zero_demand'), req('Z', 'CNC1', 4, 4, 'ok')]);
    expect(movedTo(result, 'X')).toEqual(['07R00', '07R01', '07R02', '07R03']);
  });

  it('한 동선 = 한 공정이 한쪽 열 통째보다 먼저다', () => {
    // X-CNC2(동선 7 L, 8대)가 5대 부족. 붙을 수 있는 후보 둘:
    //   동선 6 R(등 맞닿음): P-CNC1 8대 — 통째로 바꿀 수 있지만 그 동선 맞은편 Z 가 CNC1 이라 공정이 섞인다
    //   동선 7 R(마주봄): Q-CNC2 10대 — 끝 5대만 바뀌지만 동선 7 전체가 CNC2 로 남는다
    const result = run([
      { walkway: 6, side: 'L', cells: fill(8, 'Z', 'CNC1') },
      { walkway: 6, side: 'R', cells: fill(8, 'P', 'CNC1') },
      { walkway: 7, side: 'L', cells: fill(8, 'X', 'CNC2') },
      { walkway: 7, side: 'R', cells: fill(10, 'Q', 'CNC2') },
    ], [req('X', 'CNC2', 13, 8, 'shortage'), req('P', 'CNC1', 0, 8, 'zero_demand'), req('Q', 'CNC2', 0, 10, 'zero_demand'), req('Z', 'CNC1', 8, 8, 'ok')]);
    expect(movedTo(result, 'X')).toHaveLength(5);
    expect(movedTo(result, 'X').every(n => n.startsWith('07R'))).toBe(true);
  });

  it('좌우 한쪽 열을 먼저: 두 열에서 반씩이 아니라 한쪽 열을 통째로', () => {
    const result = run([
      { walkway: 2, side: 'R', cells: fill(8, 'Y', 'CNC1') },
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 3, side: 'R', cells: fill(8, 'Y', 'CNC1') },
    ], [req('X', 'CNC1', 16, 8, 'shortage'), req('Y', 'CNC1', 0, 16, 'zero_demand')]);
    expect(movedTo(result, 'X')).toHaveLength(8);
    expect(new Set(movedTo(result, 'X').map(n => n.slice(0, 3))).size).toBe(1);
  });

  it('섬 금지: 무리에 붙을 수 있는 열만 쓴다 (이름 순서로 먼저인 먼 열보다 등 맞닿은 옆 열)', () => {
    const result = run([
      { walkway: 2, side: 'L', cells: fill(6, 'Q', 'CNC1') },
      { walkway: 8, side: 'R', cells: fill(6, 'P', 'CNC1') },
      { walkway: 9, side: 'L', cells: fill(6, 'X', 'CNC1') },
      { walkway: 9, side: 'R', cells: fill(6, 'X', 'CNC1') },
    ], [req('X', 'CNC1', 18, 12, 'shortage'), req('P', 'CNC1', 0, 6, 'zero_demand'), req('Q', 'CNC1', 0, 6, 'zero_demand')]);
    expect(movedTo(result, 'X')).toEqual(Array.from({ length: 6 }, (_, i) => `08R${String(i).padStart(2, '0')}`));
  });

  it('섬 금지: 붙일 자리가 없으면 먼 곳에 새 무리를 만들지 않고 부족 알림으로 남긴다', () => {
    const result = run([
      { walkway: 2, side: 'L', cells: fill(6, 'Q', 'CNC1') },
      { walkway: 9, side: 'L', cells: fill(6, 'X', 'CNC1') },
      { walkway: 9, side: 'R', cells: fill(6, 'X', 'CNC1') },
    ], [req('X', 'CNC1', 15, 12, 'shortage'), req('Q', 'CNC1', 0, 6, 'zero_demand')]);
    expect(result.moves).toEqual([]);
    expect(result.unresolved).toEqual([{ modelId: 'X', processId: pid('X', 'CNC1'), remaining: 3 }]);
  });

  it('무리가 없는 새 모델은 키울 자리가 있는 곳에서 시작해 한 무리로 키운다', () => {
    // N(설비 0대)이 8대 필요. 동선 2 L 은 4대뿐이고 붙을 옆 열이 없다(이름 순서로는 먼저).
    // 동선 5 는 L·R 4대씩 — 여기서 시작해야 8대가 한 무리가 된다.
    const result = run([
      { walkway: 2, side: 'L', cells: fill(4, 'Y', 'CNC1') },
      { walkway: 5, side: 'L', cells: fill(4, 'Y', 'CNC1') },
      { walkway: 5, side: 'R', cells: fill(4, 'Y', 'CNC1') },
    ], [req('N', 'CNC1', 8, 0, 'shortage'), req('Y', 'CNC1', 0, 12, 'zero_demand')]);
    expect(movedTo(result, 'N')).toHaveLength(8);
    expect(movedTo(result, 'N').every(n => n.startsWith('05'))).toBe(true);
    expect(result.unresolved).toEqual([]);
  });

  it('열은 최대 2조각: 한 열 양 끝에 서로 다른 모델이 들어와 가운데가 끼이는 일은 없다', () => {
    // 동선 3 R 의 H 8대(여유). X(동선 3 L)와 W(동선 4 L)가 각각 2대 부족 — 둘 다 그 열에 붙을 수 있다.
    // 하나가 한쪽 끝을 가져가면, 다른 하나가 반대쪽 끝을 가져가 X|H|W 세 조각이 되면 안 된다.
    const result = run([
      { walkway: 3, side: 'L', cells: fill(8, 'X', 'CNC1') },
      { walkway: 3, side: 'R', cells: fill(8, 'H', 'CNC1') },
      { walkway: 4, side: 'L', cells: fill(8, 'W', 'CNC1') },
    ], [req('X', 'CNC1', 10, 8, 'shortage'), req('W', 'CNC1', 10, 8, 'shortage'), req('H', 'CNC1', 0, 8, 'zero_demand')]);
    expect(result.moves).toHaveLength(2);
    expect(result.unresolved.reduce((s, u) => s + u.remaining, 0)).toBe(2);
  });
});
