import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 비가동/실가동이 확인되지 않은 기록은 서버가 OEE 를 NULL 로 남긴다
 * (resolveActualRuntime: "런타임 미보고는 완전 가동으로 추정하지 않고 NULL로 유지한다").
 *
 * 이 NULL 을 0 으로 뭉개면 정상 가동 중인 설비가 완전 정지처럼 빨간 0.0% 로 보인다.
 * 2026-07-16 실제로 `(oee || 0) * 100` 때문에 396건(전체 10.3%)이 0.0% 로 표시됐다.
 * 진짜 0 인 기록은 7건뿐이었다.
 *
 * EngineerDashboard 는 같은 규약을 이미 계약 테스트로 고정하고 있다
 * (EngineerDashboard.unreportedOee.test.ts). 목록 화면만 누락되어 있었다.
 */
describe('ProductionRecordList unreported OEE contract', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/production/ProductionRecordList.tsx'),
    'utf8'
  );

  it('does not coerce a null OEE to 0%', () => {
    // `(oee || 0)` / `oee ?? 0` 류의 강제 변환은 미보고와 실제 0% 를 구분 불가능하게 만든다.
    expect(source).not.toMatch(/\(\s*oee\s*(\|\||\?\?)\s*0\s*\)/);
    expect(source).not.toMatch(/oee\s*(\|\||\?\?)\s*0\s*\)\s*\*\s*100/);
  });

  it('renders unreported records with an explicit label instead of a graded percentage', () => {
    expect(source).toMatch(/oee\s*===\s*null\s*\|\|\s*oee\s*===\s*undefined/);
    expect(source).toMatch(/recordList\.oeeUnreported/);
  });

  it('types the OEE metrics as nullable so the distinction survives', () => {
    expect(source).toMatch(/oee\?:\s*number\s*\|\s*null/);
    expect(source).toMatch(/availability\?:\s*number\s*\|\s*null/);
  });
});
