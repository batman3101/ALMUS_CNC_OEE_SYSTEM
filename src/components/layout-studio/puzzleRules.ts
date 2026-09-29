/**
 * 퍼즐 배치의 규칙 판정 — 조각을 설비에 놓으면 동선 규칙에 맞는가(사용자 확정 2026-09-28).
 *
 * 추천 알고리즘(src/lib/layout-planning/recommendLayout.ts)과 같은 규칙을 화면에서 끌어 놓는 순간에 보여 준다:
 *   · 섬 금지 — 같은 모델·공정 무리에 붙어야 한다(같은 열 이어서 · 마주본 열 · 등 맞닿은 옆 열, 행이 겹침)
 *   · 빼 오는 쪽도 섬 금지 — 원래 자리의 무리가 갈라지면 안 된다(split, 사용자 결정 2026-09-29)
 *   · 열은 최대 2조각(이미 더 쪼개진 열은 더 쪼개지 않음) · 열 중간 끼워넣기 금지
 *   · 한 동선 = 한 공정 — 공정이 섞이면 경고(막지는 않는다)
 * 판정은 막지 않고 보여 주기만 한다. 사람이 판단해 놓을 수 있어야 하기 때문이다(붙일 자리가 없는 부족은 사용자가
 * 미세조정한다 — 사용자 결정).
 *
 * 순수 함수라 엔진(studioEngine.js)과 단위 테스트가 같은 코드를 쓴다.
 */

export interface PuzzleMachine {
  id: number;
  y: number;
  height: number;
  walkway: string | null;
  side: 'L' | 'R' | null;
}

/** 설비에 놓인 조각: '<모델>\u0000<공정 코드>' 또는 빈 자리(null). */
export type PieceKey = string | null;
export type PuzzleState = ReadonlyMap<number, PieceKey>;

export type Level = 'good' | 'warn' | 'bad';
export type Reason = 'island' | 'split' | 'middle' | 'three_pieces' | 'mixed_process';

export const pieceKey = (model: string, process: string): PieceKey => (model ? `${model}\u0000${process}` : null);
const processOf = (key: PieceKey) => (key ? key.slice(key.indexOf('\u0000') + 1) : null);

export class PuzzleBoard {
  /** 열(동선의 한쪽) → 위에서 아래로 설비 번호. */
  readonly columns = new Map<string, number[]>();
  private readonly columnOfId = new Map<number, string>();
  private readonly byId = new Map<number, PuzzleMachine>();
  private readonly tolerance: number;

  constructor(machines: PuzzleMachine[]) {
    for (const m of machines) {
      this.byId.set(m.id, m);
      if (!m.walkway || !m.side) continue;
      const key = `${m.walkway}|${m.side}`;
      if (!this.columns.has(key)) this.columns.set(key, []);
      this.columns.get(key)!.push(m.id);
      this.columnOfId.set(m.id, key);
    }
    for (const ids of this.columns.values()) ids.sort((a, b) => this.byId.get(a)!.y - this.byId.get(b)!.y);
    // 행이 겹친다 = 한 행 피치(72) 안. 62 높이 상자에서 1.3 배 — 추천 알고리즘과 같은 값.
    this.tolerance = Math.max(0, ...machines.map(m => m.height)) * 1.3;
  }

  /** 도면에 동선 정보가 있는가. 없으면 규칙을 보여 줄 수 없다(모두 good). */
  get hasWalkways() { return this.columns.size > 0; }

  columnOf(id: number) { return this.columnOfId.get(id) ?? null; }

  /** 마주본 열과 등이 맞닿은 옆 열(동선 n 의 R ↔ 동선 n+1 의 L, 같은 동·같은 통로 쪽). */
  neighbourColumns(column: string): string[] {
    const bar = column.lastIndexOf('|');
    const walkway = column.slice(0, bar), side = column.slice(bar + 1);
    const [b, n, ud] = walkway.split('-');
    const next = Number(n) + (side === 'R' ? 1 : -1);
    const back = `${b}-${String(next).padStart(n.length, '0')}-${ud}|${side === 'R' ? 'L' : 'R'}`;
    return [`${walkway}|${side === 'L' ? 'R' : 'L'}`, back].filter(c => this.columns.has(c));
  }

  /** `id` 에서 시작해 같은 열 아래로 n 대(끝에 닿으면 위로 당김). 열이 n 대보다 짧으면 null. */
  blockFrom(id: number, n: number): number[] | null {
    if (n <= 1) return [id];
    const column = this.columnOf(id);
    if (!column) return null;
    const ids = this.columns.get(column)!;
    if (ids.length < n) return null;
    const p = ids.indexOf(id);
    const start = Math.max(0, Math.min(p, ids.length - n));
    return ids.slice(start, start + n);
  }

  /** 같은 열에서 두 설비 사이(양 끝 포함). 다른 열이면 null. */
  range(a: number, b: number): number[] | null {
    const column = this.columnOf(a);
    if (!column || column !== this.columnOf(b)) return null;
    const ids = this.columns.get(column)!;
    const [i, j] = [ids.indexOf(a), ids.indexOf(b)].sort((x, y) => x - y);
    return ids.slice(i, j + 1);
  }

  private runs(state: PuzzleState, ids: number[]) {
    return ids.filter((id, i) => i === 0 || state.get(id) !== state.get(ids[i - 1])).length;
  }

  /** 조각 `key` 를 `targets` 에 놓으면 규칙상 어떤가. `state` 는 놓기 전 상태. */
  evaluate(state: PuzzleState, key: PieceKey, targets: number[]): { level: Level; reasons: Reason[] } {
    if (!this.hasWalkways || key === null) return { level: 'good', reasons: [] };
    const after = new Map(state);
    for (const t of targets) after.set(t, key);
    const reasons = new Set<Reason>();

    for (const column of new Set(targets.map(t => this.columnOf(t)).filter((c): c is string => !!c))) {
      const ids = this.columns.get(column)!;
      if (this.runs(after, ids) > Math.max(2, this.runs(state, ids))) reasons.add('three_pieces');
      const seq = ids.map(id => after.get(id));
      const first = seq.indexOf(key), last = seq.lastIndexOf(key);
      if (seq.slice(first, last + 1).some(x => x !== key) || (first !== 0 && last !== ids.length - 1)) reasons.add('middle');
    }

    // 섬: 무리가 이미 있는데(놓는 자리 밖에) 놓는 자리가 그 무리에 닿지 않는다.
    const targetSet = new Set(targets);
    const hasOthers = [...state].some(([id, k]) => k === key && !targetSet.has(id));
    if (hasOthers) {
      const attached = targets.some(t => {
        const column = this.columnOf(t);
        if (!column) return false;
        if (this.columns.get(column)!.some(id => !targetSet.has(id) && state.get(id) === key)) return true;
        const y = this.byId.get(t)!.y;
        return this.neighbourColumns(column).some(c => this.columns.get(c)!
          .some(id => state.get(id) === key && Math.abs(this.byId.get(id)!.y - y) <= this.tolerance));
      });
      if (!attached) reasons.add('island');
    }
    // 빼 오는 쪽: 놓는 자리에 있던 모델·공정이 이 때문에 더 갈라지면 안 된다.
    for (const displaced of new Set(targets.map(t => state.get(t)).filter((k): k is string => !!k && k !== key))) {
      if (this.groupsOf(after, displaced) > this.groupsOf(state, displaced)) reasons.add('split');
    }
    if (reasons.size) return { level: 'bad', reasons: [...reasons] };

    // 한 동선 = 한 공정: 동선(양쪽 열)에 다른 공정이 남으면 경고.
    const walkway = this.columnOf(targets[0])?.split('|')[0];
    const process = processOf(key);
    const mixed = [...this.columns.entries()]
      .filter(([c]) => c.split('|')[0] === walkway)
      .some(([, ids]) => ids.some(id => after.get(id) !== null && after.get(id) !== undefined && processOf(after.get(id)!) !== process));
    return mixed ? { level: 'warn', reasons: ['mixed_process'] } : { level: 'good', reasons: [] };
  }

  /** 모델·공정의 무리 수(같은 열 연속 · 마주본/등 맞닿은 열에서 행이 겹치면 한 무리). */
  private groupsOf(state: PuzzleState, key: PieceKey): number {
    const members = [...state].filter(([, k]) => k === key).map(([id]) => id).filter(id => this.columnOf(id));
    const parent = new Map(members.map(id => [id, id]));
    const find = (id: number): number => { while (parent.get(id) !== id) id = parent.get(id)!; return id; };
    const set = new Set(members);
    for (const id of members) {
      const column = this.columnOf(id)!;
      const ids = this.columns.get(column)!;
      const next = ids[ids.indexOf(id) + 1];
      if (next !== undefined && set.has(next)) parent.set(find(id), find(next));
      const y = this.byId.get(id)!.y;
      for (const c of this.neighbourColumns(column)) {
        for (const other of this.columns.get(c)!) {
          if (set.has(other) && Math.abs(this.byId.get(other)!.y - y) <= this.tolerance) parent.set(find(id), find(other));
        }
      }
    }
    return new Set(members.map(find)).size;
  }

  /**
   * 기준(현재 배치)보다 나빠진 곳: 무리가 기준보다 더 갈라진 모델·공정의 섬 수 + 기준보다 더 쪼개진(3조각 이상) 열 수.
   * `machines` 는 그 위반에 걸린 바뀐 설비 — 도면에 표시한다.
   */
  violations(state: PuzzleState, base: PuzzleState): { count: number; machines: Set<number> } {
    if (!this.hasWalkways) return { count: 0, machines: new Set() };
    let count = 0;
    const machines = new Set<number>();
    for (const key of new Set([...state.values()].filter((k): k is string => k !== null))) {
      const before = Math.max(1, this.groupsOf(base, key)), now = this.groupsOf(state, key);
      if (now > before) {
        count += now - before;
        for (const [id, k] of state) if (k === key && base.get(id) !== k) machines.add(id);
      }
    }
    for (const ids of this.columns.values()) {
      if (this.runs(state, ids) > Math.max(2, this.runs(base, ids))) {
        count++;
        for (const id of ids) if (state.get(id) !== base.get(id)) machines.add(id);
      }
    }
    return { count, machines };
  }
}
