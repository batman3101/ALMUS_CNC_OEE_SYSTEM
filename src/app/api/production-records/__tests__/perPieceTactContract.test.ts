import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * tact_time_seconds 는 개당(1 piece) 가공시간이다. JIG 의 cavity 수는 이미 그 값에
 * 반영되어 있으므로(사이클 1,152초 / 2 cavity = 개당 576초), 어떤 경로에서든 cavity 로
 * 다시 나누면 이론 생산시간이 1/cavity 로 줄고 성능·OEE 가 그만큼 왜곡된다.
 *
 * 2026-07-16 실제로 이 버그가 5개 파일에 동시에 존재해 전 설비 OEE 가 48.8%(cavity 2)
 * 또는 24.5%(cavity 4)로 찍혔다. 저장 경로가 여러 곳(신규/일일/수정)에 흩어져 있어
 * 한 곳만 고치면 나머지가 조용히 잘못된 값을 계속 쓴다.
 *
 * 개별 함수가 export 되지 않은 route 파일이 많아, 소스 텍스트 계약으로 전 경로를
 * 한 번에 고정한다. (기존 processCompletenessContract.test.ts 와 동일한 패턴)
 */
const OEE_WRITE_PATHS = [
  'src/app/api/production-records/oeeRules.ts',
  'src/app/api/production-records/route.ts',
  'src/app/api/production-records/daily/route.ts',
  'src/app/api/production-records/[recordId]/route.ts',
  'src/components/data-input/ShiftDataInputForm.tsx',
  'src/utils/oeeCalculator.ts',
  'src/hooks/useProductionRecords.ts',
];

/** 주석 줄을 제거해 실제 코드만 남긴다 (주석은 cavity 를 설명해야 하므로). */
function codeLinesOf(source: string): string[] {
  return source.split('\n').filter((line) => {
    const t = line.trim();
    return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  });
}

/**
 * 산술 연산자(/ 또는 *) 뒤에 cavity 가 오는 코드.
 * `params.cavity` 처럼 점이 들어간 경로와 `Math.max(1, cavityCount)` 래핑을 모두 잡는다.
 */
const CAVITY_IN_ARITHMETIC = /[/*]\s*(?:Math\.max\([^)]*cavity[^)]*\)|[\w.]*cavity[\w.]*)/i;

describe('per-piece tact contract: cavity must never enter OEE/CAPA math', () => {
  test.each(OEE_WRITE_PATHS)('%s does not divide or multiply by cavity', (path) => {
    const offenders = codeLinesOf(readFileSync(resolve(process.cwd(), path), 'utf8'))
      .filter((line) => CAVITY_IN_ARITHMETIC.test(line))
      .map((line) => line.trim());

    expect(offenders).toEqual([]);
  });

  test('minutesPerUnit is always tact/60 across every write path', () => {
    const offenders: string[] = [];

    for (const path of OEE_WRITE_PATHS) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8');
      // 줄 끝까지 캡처한다. `[^,\n]+` 로 자르면 Math.max(1, ...) 의 쉼표에서 끊겨
      // cavity 에 도달하지 못한다 (2026-07-16 이 테스트가 실제로 그렇게 새어나갔다).
      for (const assignment of source.match(/minutesPerUnit:.*/g) ?? []) {
        // 레거시 역산 경로(ideal_runtime / output_qty)는 cavity 를 몰라도 되는 예외.
        if (/ideal_runtime|storedIdeal|existing\.output_qty/.test(assignment)) continue;
        if (/cavity/i.test(assignment)) offenders.push(`${path}: ${assignment.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
