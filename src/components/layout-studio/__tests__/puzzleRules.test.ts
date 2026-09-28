import { PuzzleBoard, pieceKey, type PuzzleMachine, type PieceKey } from '../puzzleRules';

/*
 * 두 동선, 네 열, 열마다 4대(위→아래 72 간격). 동선 1 의 R 열과 동선 2 의 L 열은 등이 맞닿는다.
 *   B-01-U|L: 1 2 3 4   B-01-U|R: 5 6 7 8   B-02-U|L: 9 10 11 12   B-02-U|R: 13 14 15 16
 */
const column = (walkway: string, side: 'L' | 'R', ids: number[]): PuzzleMachine[] =>
  ids.map((id, i) => ({ id, y: 100 + 72 * i, height: 62, walkway, side }));
const machines = [
  ...column('B-01-U', 'L', [1, 2, 3, 4]), ...column('B-01-U', 'R', [5, 6, 7, 8]),
  ...column('B-02-U', 'L', [9, 10, 11, 12]), ...column('B-02-U', 'R', [13, 14, 15, 16]),
];
const board = new PuzzleBoard(machines);
const A = pieceKey('A', 'C1'), B = pieceKey('B', 'C1'), X = pieceKey('X', 'C1'), Q2 = pieceKey('Q', 'C2');
const state = (fill: Record<number, PieceKey>, rest: PieceKey = A) => new Map(machines.map(m => [m.id, m.id in fill ? fill[m.id] : rest]));

describe('PuzzleBoard.evaluate — 조각을 놓으면 규칙상 어떤가', () => {
  it('같은 열에서 무리를 이어 가면 good', () => {
    expect(board.evaluate(state({ 1: X }), X, [2])).toEqual({ level: 'good', reasons: [] });
  });

  it('마주본 열에서 같은 행이면 붙은 것 — 먼 행이면 섬', () => {
    expect(board.evaluate(state({ 1: X }), X, [5]).level).toBe('good');
    expect(board.evaluate(state({ 1: X }), X, [8]).reasons).toContain('island');
  });

  it('등이 맞닿은 옆 동선의 열도 붙은 것(동선 1 R ↔ 동선 2 L)', () => {
    expect(board.evaluate(state({ 5: X }), X, [9]).level).not.toBe('bad');
    // 동선 1 L ↔ 동선 2 L 은 이웃이 아니다
    expect(board.evaluate(state({ 1: X }), X, [9]).reasons).toContain('island');
  });

  it('마주본 열이 반 칸 어긋나도 한 행 안이면 붙은 것(행 겹침 허용 = 높이 × 1.3)', () => {
    const staggered = new PuzzleBoard([...column('C-01-U', 'L', [1, 2, 3]), ...column('C-01-U', 'R', [5, 6, 7]).map(m => ({ ...m, y: m.y + 36 }))]);
    const s = new Map<number, PieceKey>([[1, X], [2, A], [3, A], [5, A], [6, A], [7, A]]);
    expect(staggered.evaluate(s, X, [5]).reasons).not.toContain('island');   // 36 차이
    expect(staggered.evaluate(s, X, [6]).reasons).toContain('island');       // 108 차이
  });

  it('무리에서 떨어진 곳은 섬', () => {
    expect(board.evaluate(state({ 1: X }), X, [16]).reasons).toEqual(['island']);
  });

  it('처음 놓는 조각(무리가 없음)은 섬이 아니다', () => {
    expect(board.evaluate(state({}), X, [16]).reasons).not.toContain('island');
  });

  it('열 중간에 끼워 넣으면 middle · 3조각', () => {
    const r = board.evaluate(state({}), X, [2]);
    expect(r.level).toBe('bad');
    expect(r.reasons).toEqual(expect.arrayContaining(['middle', 'three_pieces']));
  });

  it('이미 2조각인 열의 끝에 셋째 조각을 붙이면 three_pieces', () => {
    expect(board.evaluate(state({ 3: B, 4: B }), X, [4]).reasons).toContain('three_pieces');
    // 끝 블록을 통째로 바꾸면 여전히 2조각
    expect(board.evaluate(state({ 3: B, 4: B }), X, [3, 4]).level).not.toBe('bad');
  });

  it('동선 안에 다른 공정이 남으면 warn, 같은 공정이면 good', () => {
    expect(board.evaluate(state({}), Q2, [1])).toEqual({ level: 'warn', reasons: ['mixed_process'] });
    expect(board.evaluate(state({}), B, [1])).toEqual({ level: 'good', reasons: [] });
  });

  it('빈 자리로 만드는 것은 판정하지 않는다', () => {
    expect(board.evaluate(state({}), null, [2]).level).toBe('good');
  });

  it('동선 정보가 없는 도면은 규칙을 보여 주지 않는다', () => {
    const plain = new PuzzleBoard([{ id: 1, y: 0, height: 62, walkway: null, side: null }]);
    expect(plain.hasWalkways).toBe(false);
    expect(plain.evaluate(new Map([[1, A]]), X, [1]).level).toBe('good');
  });
});

describe('PuzzleBoard.violations — 현재 배치보다 나빠진 곳', () => {
  it('현재 배치와 같으면 0', () => {
    const base = state({ 1: X, 2: X });
    expect(board.violations(base, base).count).toBe(0);
  });

  it('무리가 둘로 갈라지면 섬 1 · 바뀐 설비만 표시', () => {
    const base = state({ 1: X, 2: X });
    const now = state({ 1: X, 16: X });
    const v = board.violations(now, base);
    expect(v.count).toBe(1);
    expect([...v.machines]).toEqual([16]);
  });

  it('현재 이미 쪼개진 열은 위반으로 세지 않는다(더 쪼갤 때만)', () => {
    const base = state({ 2: B });                // A B A A — 이미 3조각
    expect(board.violations(base, base).count).toBe(0);
    const worse = state({ 2: B, 3: X });          // A B X A — 4조각
    expect(board.violations(worse, base).count).toBeGreaterThan(0);
  });
});

describe('PuzzleBoard 블록 선택', () => {
  it('blockFrom 은 열 끝에 닿으면 위로 당긴다', () => {
    expect(board.blockFrom(3, 2)).toEqual([3, 4]);
    expect(board.blockFrom(4, 2)).toEqual([3, 4]);
    expect(board.blockFrom(1, 5)).toBeNull();
  });

  it('range 는 같은 열에서만', () => {
    expect(board.range(4, 2)).toEqual([2, 3, 4]);
    expect(board.range(1, 5)).toBeNull();
  });

  it('neighbourColumns: 마주본 열 + 등 맞닿은 열', () => {
    expect(board.neighbourColumns('B-01-U|R')).toEqual(['B-01-U|L', 'B-02-U|L']);
    expect(board.neighbourColumns('B-01-U|L')).toEqual(['B-01-U|R']);
  });
});
