import fs from 'fs';
import path from 'path';

/**
 * 자격증명 리터럴이 다시 코드에 들어오는 것을 막는 회귀 검사.
 *
 * 배경 — 저장소는 공개(`batman3101/ALMUS_CNC_OEE_SYSTEM`)인데 관리자 이메일·비밀번호 쌍이
 * `LoginFormInline.tsx` 의 **주석 안에** 평문으로 있었고(Codex 감사 2026-07-29 #1),
 * `scripts/` 의 시드 스크립트 세 개에도 계정 6개의 비밀번호가 리터럴로 있었다.
 *
 * 두 가지가 이 검사의 설계를 정한다:
 *
 * 1. **주석도 검사한다.** 원본 사고가 정확히 주석에서 났다. 코드를 파싱해 문자열 리터럴만
 *    보는 방식은 그 사고를 못 잡는다. 그래서 파일을 텍스트로 훑는다.
 * 2. **환경변수 참조는 통과시킨다.** 올바른 형태(`password: process.env.X`)까지 막으면
 *    개발자가 이 검사를 끄게 되고, 꺼진 검사는 없는 검사다.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['src', 'scripts'];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.sh']);

/**
 * `password` / `passwd` / `pwd` 뒤에 `:` 또는 `=` 가 오고 따옴표 문자열이 오는 형태.
 * 주석 기호(`//`, `*`)가 앞에 있어도 걸리도록 줄 전체에서 찾는다.
 */
const CREDENTIAL_LITERAL = /\b(?:password|passwd|pwd)\w*\s*[:=]\s*(['"`])([^'"`\n]*)\1/i;

/**
 * 통과시킬 값. 빈 문자열은 폼 초기화이고, 나머지는 "이건 진짜가 아니다" 를 값 자체가
 * 말하고 있는 경우다. 값에 의미를 담게 해서, 새 픽스처를 넣는 사람이 자기 의도를
 * 코드에 적게 만든다.
 */
const ALLOWED_VALUE = /^$|fixture|placeholder|example|dummy|redacted|your[-_]?password|<.*>/i;

function collectFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/** 테스트 파일은 제외한다 — 픽스처가 정당하게 필요하고, 리뷰 대상이기도 하다. */
function isTestFile(filePath: string): boolean {
  return filePath.includes('__tests__') || /\.(test|spec)\.[jt]sx?$/.test(filePath);
}

describe('하드코딩된 자격증명 금지', () => {
  const files = SCAN_DIRS.flatMap(dir => collectFiles(path.join(REPO_ROOT, dir)));

  it('스캔 대상 파일을 실제로 찾는다', () => {
    // 경로가 틀리면 0개를 훑고 조용히 통과한다 — 그 침묵이 가장 위험한 실패 모드다.
    expect(files.length).toBeGreaterThan(100);
  });

  it('src/ 와 scripts/ 어디에도 비밀번호 리터럴이 없다 (주석 포함)', () => {
    const violations: string[] = [];

    for (const file of files) {
      if (isTestFile(file)) continue;

      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        const match = CREDENTIAL_LITERAL.exec(line);
        if (!match) return;
        if (ALLOWED_VALUE.test(match[2])) return;

        // 위반 값 자체는 출력하지 않는다 — 실패 로그가 또 하나의 유출 경로다.
        violations.push(
          `${path.relative(REPO_ROOT, file)}:${index + 1} — 비밀번호 리터럴로 보이는 값 ` +
          `(${match[2].length}자). process.env 로 옮기세요.`
        );
      });
    }

    expect(violations).toEqual([]);
  });
});
