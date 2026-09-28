"""Excel 배치 도면의 빨간 테두리(작업자 동선)에서 설비별 동선 번호·동선 쪽(L/R)을 뽑는다.

사용자 확정 2026-09-28: 빨간 선 = 작업자 동선이고, 그 양쪽 두 열이 마주본다. 동선은 가로 통로에서 끊긴다.
이 정보는 추천이 "한 동선 = 한 공정"을 지키는 데 쓰인다(supabase/migrations/20260928130000_layout_walkways.sql).

  python scripts/extract-layout-walkways.py "../CNC OEE 참조파일/Setting CNC.xlsx" > walkways.json

출력: {"<설비 번호>": {"walkway": "B-01-U", "side": "L", "cell": "B4"}, ...}
  walkway = <동>-<동선 순번 2자리>-<U: 통로 위 | D: 통로 아래>, side = 동선의 왼쪽(L)/오른쪽(R) 열.
설비 번호 n 은 도면 좌표 마이그레이션(20260925120000)과 같게 machines.name = 'CNC-' || lpad(n, 3, '0') 로 짝짓는다.
"""
import json
import sys

import openpyxl

SHEET = 'W39'
# 도면의 동 구역(행 범위)과 가로 통로 행. 20260925120000 좌표 마이그레이션과 같은 구역이다.
BUILDINGS = (('B', 4, 39), ('A', 43, 86))


def is_red(side):
    return (side is not None and side.style and side.color is not None
            and isinstance(side.color.rgb, str) and side.color.rgb.upper().endswith('FF0000'))


def main(path):
    ws_formula = openpyxl.load_workbook(path)[SHEET]              # 테두리
    ws = openpyxl.load_workbook(path, data_only=True)[SHEET]      # 값: 66–72, 74 는 수식 셀이라 계산값으로 읽는다

    def red_between(row, left_col):
        """left_col 과 left_col+1 사이 경계가 빨간가."""
        return is_red(ws_formula.cell(row=row, column=left_col).border.right) or \
            is_red(ws_formula.cell(row=row, column=left_col + 1).border.left)

    out = {}
    for building, top, bottom in BUILDINGS:
        # 설비 번호 셀 찾기(번호 셀 아래 행이 모델·공정 라벨)
        machines = []
        for row in range(top, bottom + 1):
            for col in range(1, ws.max_column + 1):
                v = ws.cell(row=row, column=col).value
                if isinstance(v, (int, float)) and float(v).is_integer() and 1 <= int(v) <= 800:
                    machines.append((int(v), row, col))
        for n, row, col in machines:
            # 동선 짝: 오른쪽 경계가 빨가면 (col, col+1), 왼쪽이 빨가면 (col-1, col).
            # 열 맨 위라 테두리가 없는 셀(예: 98)은 같은 열의 다른 설비가 가진 짝을 따른다.
            if red_between(row, col) or red_between(row + 1, col):
                left, side = col, 'L'
            elif red_between(row, col - 1) or red_between(row + 1, col - 1):
                left, side = col - 1, 'R'
            else:
                left, side = None, None
                for _, r2, c2 in machines:
                    if c2 != col or r2 == row:
                        continue
                    if red_between(r2, col):
                        left, side = col, 'L'
                        break
                    if red_between(r2, col - 1):
                        left, side = col - 1, 'R'
                        break
                if left is None:
                    raise SystemExit(f'machine {n} ({building} r{row}c{col}): no walkway found')
            # 가로 통로에서 동선이 끊긴다: 이 짝 경계의 빨간 행을 연속 구간으로 나눠 몇 번째 구간인지 본다.
            red_rows = [r for r in range(top, bottom + 1) if red_between(r, left)]
            runs, start, prev = [], None, None
            for r in red_rows:
                if start is None:
                    start = prev = r
                elif r == prev + 1:
                    prev = r
                else:
                    runs.append((start, prev))
                    start = prev = r
            if start is not None:
                runs.append((start, prev))
            # 설비 셀(또는 라벨 행)이 들어 있는 구간, 없으면 가장 가까운 구간
            section = min(range(len(runs)), key=lambda i: 0 if runs[i][0] <= row + 1 and row <= runs[i][1]
                          else min(abs(row - runs[i][0]), abs(row - runs[i][1])))
            # 통로 위/아래: 이 동의 가로 통로 행(모든 짝에서 끊기는 행)을 기준으로 판정
            out[n] = {'building': building, 'pair': left, 'run_top': runs[section][0], 'side': side,
                      'cell': ws.cell(row=row, column=col).coordinate}

    # 동별 가로 통로: 어떤 짝에서도 빨간 테두리가 없는 행 중 동 구역 안쪽에 있는 행
    result = {}
    for building, top, bottom in BUILDINGS:
        items = {n: v for n, v in out.items() if v['building'] == building}
        pairs = sorted({v['pair'] for v in items.values()})
        aisle_rows = [r for r in range(top + 2, bottom - 1)
                      if not any(red_between(r, p) for p in pairs)
                      and any(red_between(r - 1, p) for p in pairs) and any(red_between(r + 1, p) for p in pairs)]
        if len(aisle_rows) != 1:
            raise SystemExit(f'{building}: expected exactly one aisle row, got {aisle_rows}')
        aisle = aisle_rows[0]
        for n, v in items.items():
            index = pairs.index(v['pair']) + 1
            result[n] = {'walkway': f"{building}-{index:02d}-{'U' if v['run_top'] < aisle else 'D'}",
                         'side': v['side'], 'cell': v['cell']}

    if len(result) != 800:
        missing = [n for n in range(1, 801) if n not in result]
        raise SystemExit(f'expected 800 machines, got {len(result)}; missing {missing}')
    json.dump({str(n): result[n] for n in sorted(result)}, sys.stdout, ensure_ascii=False, indent=0)


if __name__ == '__main__':
    main(sys.argv[1])
