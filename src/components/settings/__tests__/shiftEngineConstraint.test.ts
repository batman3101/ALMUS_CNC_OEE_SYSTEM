/**
 * 교대 설정 UI 가 허용하는 값 = 실시간 엔진이 지원하는 값. (감사 2026-08-06 HIGH-04)
 *
 * 예전 UI 는 두 교대 시작 시각이 다르기만 하면 임의의 비대칭 교대를 저장할 수 있었고,
 * 휴식은 0~240분을 허용했다. 그런데 엔진 쪽 사실은 이렇다:
 *
 *   - `shiftBreaks.SHIFT_BREAK_WINDOWS` 의 휴식 시간대는 교대 시작 기준 **고정 오프셋**이고
 *     마지막 구간이 600분에서 끝난다(`BREAK_WINDOWS_END_OFFSET_MINUTES`).
 *   - `calculateRealtimeProgress` 는 `operatingMinutes < 600` 이면 예외를 던진다.
 *   - `MachineConsole` 은 `operatingMinutes === 720` 이 아니면 실시간 지표를 감춘다.
 *   - `/api/production-progress` 는 설정 휴식 총량이 `TOTAL_BREAK_MINUTES` 와 다르면
 *     `break_config_matches: false` 로 계산을 중단한다.
 *
 * 그래서 지원 밖의 값을 저장하면 **저장은 성공하고 설비 콘솔의 실시간 화면만 조용히
 * 사라진다.** 확정 OEE 는 새 설정을 따르므로 증상이 더 헷갈린다. 이 테스트는 UI 의 제약과
 * 엔진의 제약이 갈라지는 순간 실패한다.
 */
import fs from 'fs';
import path from 'path';
import { TOTAL_BREAK_MINUTES, BREAK_WINDOWS_END_OFFSET_MINUTES } from '@/utils/shiftBreaks';

const TAB_SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'src', 'components', 'settings', 'tabs', 'ShiftSettingsTab.tsx'),
  'utf-8',
);
const CONSOLE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'src', 'components', 'dashboard', 'operator-console', 'MachineConsole.tsx'),
  'utf-8',
);

/** 탭이 선언한 지원 교대 길이를 소스에서 읽는다. */
function declaredSupportedShiftMinutes(): number {
  const match = TAB_SOURCE.match(/const SUPPORTED_SHIFT_MINUTES\s*=\s*(\d+)/);
  if (!match) throw new Error('ShiftSettingsTab 에 SUPPORTED_SHIFT_MINUTES 선언이 없다');
  return Number(match[1]);
}

describe('교대 설정 UI 와 실시간 엔진의 지원 범위', () => {
  it('탭이 선언한 교대 길이가 설비 콘솔이 요구하는 길이와 같다', () => {
    const supported = declaredSupportedShiftMinutes();
    // MachineConsole: `progress.operatingMinutes === 720`
    const consoleGuard = CONSOLE_SOURCE.match(/operatingMinutes === (\d+)/);
    expect(consoleGuard).not.toBeNull();
    expect(supported).toBe(Number(consoleGuard![1]));
  });

  it('지원 교대 길이가 휴식 시간대를 담을 수 있다', () => {
    // 이보다 짧으면 calculateRealtimeProgress 가 예외를 던진다.
    expect(declaredSupportedShiftMinutes()).toBeGreaterThanOrEqual(BREAK_WINDOWS_END_OFFSET_MINUTES);
  });

  it('휴식 입력이 엔진 상수 하나로만 잠겨 있다', () => {
    // min/max 를 리터럴로 박으면 shiftBreaks 가 바뀔 때 조용히 갈라진다. 상수를 참조해야 한다.
    expect(TAB_SOURCE).toContain("import { TOTAL_BREAK_MINUTES } from '@/utils/shiftBreaks'");
    expect(TAB_SOURCE).toMatch(/min=\{TOTAL_BREAK_MINUTES\}/);
    expect(TAB_SOURCE).toMatch(/max=\{TOTAL_BREAK_MINUTES\}/);
    // 예전 범위(0~240)가 남아 있으면 안 된다.
    expect(TAB_SOURCE).not.toMatch(/max=\{240\}/);
  });

  it('저장 경로가 교대 길이와 휴식 총량을 모두 막는다', () => {
    // UI 범위 제한만으로는 부족하다 — 폼 값은 다른 경로로도 들어올 수 있으므로
    // handleSave 안에서도 거부해야 한다.
    expect(TAB_SOURCE).toMatch(/shortestShift !== SUPPORTED_SHIFT_MINUTES/);
    expect(TAB_SOURCE).toMatch(/breakMinutes !== TOTAL_BREAK_MINUTES/);
  });

  it('엔진 상수 자체가 현재 운영 값과 일치한다', () => {
    // 라이브 system_settings.shift.break_time_minutes = 110 (2026-08-06 실측).
    // 이 값이 바뀌면 초기화 레지스트리·UI 잠금·API fail-closed 가 한꺼번에 움직여야 한다.
    expect(TOTAL_BREAK_MINUTES).toBe(110);
  });
});
