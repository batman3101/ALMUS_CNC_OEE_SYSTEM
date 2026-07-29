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

/** 비밀번호를 가리키는 라벨. 한국어를 포함한다 — 이유는 아래 PATTERNS 주석 참조. */
const LABEL = String.raw`(?:password|passwd|pwd|비밀번호|암호)`;

/**
 * 자격증명 리터럴의 **두 가지** 모양. 하나만으로는 못 잡는다.
 *
 * (a) 라벨이 문자열 **밖**: `password: 'value'`, `const pwd = "value"`
 * (b) 라벨이 문자열 **안**: `console.log('임시 비밀번호: value')`
 *
 * (b) 를 뒤늦게 추가한 이유가 이 검사의 교훈이다. 2026-07-29 적대적 재감사에서 같은
 * 비밀번호가 스크립트 두 곳에 남아 있는 것이 발견됐는데, 이 검사는 **통과하고 있었다**.
 * 변수는 이미 `process.env.SEED_USER_PASSWORD` 로 옮겨져 (a) 를 만족했지만,
 * 마지막에 결과를 안내하는 `console.log('임시 비밀번호: ...')` 한 줄에 평문이 남아
 * 있었다. 라벨이 따옴표 안에 있으니 (a) 패턴에는 걸릴 수가 없다.
 *
 * 즉 "비밀번호를 변수에서 치웠다"와 "비밀번호가 코드에 없다"는 다른 명제다. 검사가
 * 전자만 보고 후자라고 말하고 있었다.
 */
/** (a) 라벨이 문자열 밖. 값은 따옴표 안. */
const LABEL_OUTSIDE = new RegExp(String.raw`\b${LABEL}\w*\s*[:=]\s*(['"\`])([^'"\`\n]*)\1`, 'i');

/**
 * (b) 는 정규식 하나로 처리하지 않는다. **문자열을 먼저 잘라내고** 그 내용만 본다.
 *
 * 한 줄 전체에 `(['"])[^'"]*라벨...\1` 같은 패턴을 돌리면 닫는 따옴표를 여는 따옴표로
 * 오인해 문자열 경계를 넘어 매칭한다. 실제로 이 검사를 만들면서
 *   { name: '박관리', email: 'admin3@...', password: SEED_PASSWORD, role: 'admin' }
 * 가 위반으로 잡혔다 — `'admin3@...'` 의 **닫는** 따옴표부터 `'admin'` 의 여는 따옴표까지를
 * 한 문자열로 본 것이다. 올바른 코드를 위반이라 부르는 검사는 곧 꺼진다.
 */
const STRING_LITERAL = /'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\\n]*)`/g;
const LABEL_INSIDE = new RegExp(String.raw`${LABEL}\s*[:：]\s*(\S.*)$`, 'i');

/** 한 줄에서 자격증명 리터럴로 보이는 **값**을 찾는다. 없으면 null. */
function findCredentialValue(line: string): string | null {
  const outside = LABEL_OUTSIDE.exec(line);
  if (outside && !ALLOWED_VALUE.test(outside[2])) return outside[2];

  STRING_LITERAL.lastIndex = 0;
  for (let m = STRING_LITERAL.exec(line); m !== null; m = STRING_LITERAL.exec(line)) {
    const content = m[1] ?? m[2] ?? m[3] ?? '';
    const inside = LABEL_INSIDE.exec(content);
    if (inside && !ALLOWED_VALUE.test(inside[1])) return inside[1];
  }
  return null;
}

/**
 * 통과시킬 값. 빈 문자열은 폼 초기화이고, 나머지는 "이건 진짜가 아니다" 를 값 자체가
 * 말하고 있는 경우다. 값에 의미를 담게 해서, 새 픽스처를 넣는 사람이 자기 의도를
 * 코드에 적게 만든다.
 *
 * 환경변수 참조(`process.env.X`, `${X}`)와 "환경변수에 설정한 값" 같은 **안내 문구**도
 * 통과시킨다. 올바른 형태까지 막으면 개발자가 검사를 끄게 되고, 꺼진 검사는 없는 검사다.
 */
const ALLOWED_VALUE =
  /^$|fixture|placeholder|example|dummy|redacted|your[-_]?password|<.*>|process\.env|\$\{|환경변수/i;

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
        // 라벨이 문자열 밖이든 안이든 잡는다. 앞 형태만 보던 검사가 통과하는 동안
        // 뒤 형태로 평문이 살아남아 있었다(재감사 #3).
        const value = findCredentialValue(line);
        if (value === null) return;

        // 위반 값 자체는 출력하지 않는다 — 실패 로그가 또 하나의 유출 경로다.
        violations.push(
          `${path.relative(REPO_ROOT, file)}:${index + 1} — 비밀번호 리터럴로 보이는 값 ` +
          `(${value.length}자). process.env 로 옮기세요.`
        );
      });
    }

    expect(violations).toEqual([]);
  });
});
