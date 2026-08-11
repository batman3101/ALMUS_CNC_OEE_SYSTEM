import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 목록 화면의 수정 요청 계약.
 *
 * ⚠ 2026-08-11: 이 파일의 마지막 단언은 예전에 **버그를 고정하고 있었다**.
 * `body: JSON.stringify({ output_qty, defect_qty })` 를 정규식으로 강제했기 때문에,
 * 미검사(NULL) 행에서 생산량만 고쳐도 `defect_qty` 가 **항상** 함께 전송됐다.
 * 목록 API 가 NULL 을 0 으로 내려보내던 시절엔 그 값이 0 이었고, 서버는 그것을
 * "불량 0건 확정"으로 해석해 quality/OEE 까지 계산했다 — 검사하지 않은 교대가 조용히
 * 확정되는 경로였다.
 *
 * 지금 계약은 반대다: **비어 있으면 보내지 않는다**. 서버(`buildUpdateData`)는 `undefined`
 * 를 "이 필드는 건드리지 않음"으로 읽어 기존 NULL 을 그대로 둔다.
 */
describe('ProductionRecordList quantity edits', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/production/ProductionRecordList.tsx'),
    'utf8'
  );

  it('파생 지표를 클라이언트에서 계산해 보내지 않는다 (서버가 단일 진실 공급원)', () => {
    expect(source).not.toMatch(/const quality = values\.output_qty/);
    expect(source).not.toMatch(/quality:\s*Math\.round\(quality/);
  });

  it('불량 수량이 비어 있으면 defect_qty 를 요청 본문에서 뺀다', () => {
    // 값이 없을 때 output_qty 만 담는 분기가 존재해야 한다.
    expect(source).toMatch(
      /values\.defect_qty === null \|\| values\.defect_qty === undefined\s*\?\s*\{\s*output_qty:\s*values\.output_qty\s*\}/
    );
  });

  it('defect_qty 를 무조건 실어 보내지 않는다 (미검사 NULL 이 0 으로 확정되던 경로)', () => {
    expect(source).not.toMatch(
      /body:\s*JSON\.stringify\(\{\s*output_qty:\s*values\.output_qty,\s*defect_qty:\s*values\.defect_qty\s*\}\)/
    );
  });

  it('미검사 행을 0 으로 접어 표시하지 않는다', () => {
    // `qty?.toLocaleString() || 0` 처럼 falsy 를 0 으로 접는 표현이 남아 있으면 안 된다.
    expect(source).not.toMatch(/defect_qty[\s\S]{0,200}toLocaleString\(\)\s*\|\|\s*0/);
    expect(source).not.toMatch(/\(record\.defect_qty \|\| 0\)/);
  });

  it('불량 확정은 전용 경로(/defect)를 쓴다 — 일반 PUT 이 아니다', () => {
    expect(source).toMatch(/\/api\/production-records\/\$\{[^}]+\}\/defect/);
  });
});
