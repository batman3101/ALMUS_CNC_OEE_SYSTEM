import fs from 'fs';
import path from 'path';

/**
 * 실패를 도메인 언어로 옮겨 적는 자리의 **원장**.
 *
 * ## 왜 원장인가
 *
 * 2026-07-31 이전에는 `message.error` / `showError` 호출이 30개 파일 88곳에 흩어져 있었고
 * 어느 것도 원인을 구분하지 않았다. 그래서 토큰이 만료되는 동안 사용자는
 * "비가동 내역을 불러오지 못했습니다" 를 보고 4분간 새로고침만 했다.
 *
 * 이 스캔이 `showError` 까지 함께 보는 이유가 거기 있다 — 그 19곳은 `useMessage()` 래퍼
 * 뒤에 있어서 `message.error` 만 세면 **한 곳도 보이지 않았다.** 원장이 한쪽 이름만
 * 지키면 다른 쪽 이름으로 같은 버그가 조용히 자란다.
 *
 * 전부 `useFailureReport` 로 쓸어담았지만, **그 상태는 저절로 유지되지 않는다.** 새 화면이
 * `message.error('...실패했습니다')` 한 줄을 심는 순간 같은 버그가 그 화면에서 되살아나고,
 * 그건 세션이 실제로 만료되기 전까지 아무도 모른다.
 *
 * 그래서 남은 raw 호출을 **전수로** 적어 둔다. 새 호출이 생기면 이 테스트가 깨지고, 그때
 * 딱 한 가지만 답하면 된다 — **이건 요청 실패인가, 입력 검증인가.**
 *
 * - **요청 실패** → `useFailureReport` 의 `reportFailure` 를 쓴다. 원장에 넣지 않는다.
 * - **입력 검증 / 서버가 준 도메인 답** → 아래 목록에 이유와 함께 추가한다.
 *
 * `notification.error` 는 범위 밖이다 — 그건 실패 보고가 아니라 설비 알림
 * (`useRealtimeNotifications`)이고, 세션과 무관하게 사용자에게 전달돼야 한다.
 */

/** 요청을 보내기 **전에** 사용자 입력을 막는 자리들. 세션 상태와 무관하게 항상 보여야 한다. */
const INPUT_VALIDATION = [
  "src/components/data-input/ShiftDataInputForm.tsx | message.error(t('messages.selectMachineFirst'));",
  "src/components/data-input/ShiftDataInputForm.tsx | message.error(t('messages.selectMachine'));",
  "src/components/data-input/ShiftDataInputForm.tsx | message.error(t('recordList.editModal.defectExceedsOutput'));",
  // 비가동 조회가 실패한 상태에서는 합계를 믿을 수 없으므로 저장을 막는다 — 로컬 상태 가드다.
  "src/components/data-input/ShiftDataInputForm.tsx | message.error(t('recordList.loadFailedBlockSave'));",
  // 미리보기와 업로드 두 진입점에 같은 가드가 하나씩 있다.
  "src/components/machines/MachinesBulkUpload.tsx | message.error(t('bulkUpload.messages.selectFileFirst'));",
  "src/components/machines/MachinesBulkUpload.tsx | message.error(t('bulkUpload.messages.invalidFileType'));",
  "src/components/machines/MachinesBulkUpload.tsx | message.error(t('bulkUpload.messages.fileSizeExceeded'));",
  "src/components/model-info/ModelInfoManager.tsx | message.error(t('에러.모델선택필요'));",
  "src/components/production/ProductionRecordInput.tsx | message.error(t('productionInput.validationError'));",
  "src/components/settings/tabs/GeneralSettingsTab.tsx | showError(t('settings.general.noChanges'));",
  "src/components/settings/tabs/GeneralSettingsTab.tsx | showError(t('settings.general.logoImageOnly'));",
  "src/components/settings/tabs/GeneralSettingsTab.tsx | showError(t('settings.general.logoSizeLimit'));",
  "src/components/settings/tabs/NotificationSettingsTab.tsx | showError(t('settings.notification.invalidEmail'));",
  "src/components/settings/tabs/OEESettingsTab.tsx | showError(t('settings.oee.thresholdValidation'));",
  "src/components/settings/tabs/OEESettingsTab.tsx | showError(t('settings.oee.targetValidation'));",
  "src/components/settings/tabs/ShiftSettingsTab.tsx | showError(t('settings.shift.aShiftTimeError'));",
  'src/components/settings/tabs/ShiftSettingsTab.tsx | showError(`휴식 시간은 0 이상이고 짧은 교대(${shortestShift}분)보다 작아야 합니다.`);',
  'src/components/settings/tabs/ShiftSettingsTab.tsx | showError(`교대 전환 유예는 0 이상이고 짧은 교대(${shortestShift}분)보다 작아야 합니다.`);',
];

/**
 * 서버가 **진짜 도메인 답**을 준 자리.
 *
 * 유니크 제약 위반(`23505`)은 "저장이 안 됐다"가 아니라 "그 이름은 이미 있다"는 답이다.
 * 세션 상태와 무관하게 사용자가 알아야 하고, 삼키면 사용자는 왜 안 되는지 영영 모른다.
 * 같은 `catch` 의 `else` 가지(일반 저장 실패)는 `reportFailure` 로 나갔다.
 */
const DOMAIN_ANSWER = [
  "src/components/model-info/ModelInfoManager.tsx | message.error(t('messages.modelNameExists'));",
  "src/components/model-info/ModelInfoManager.tsx | message.error(t('에러.중복공정명'));",
];

/** 서버가 아니라 **브라우저 API** 가 거절한 자리. 세션과 무관하다. */
const BROWSER_API = [
  "src/components/settings/tabs/NotificationSettingsTab.tsx | showError(t('settings.notification.permissionError'));",
];

/** 호출을 만드는 자리 자체 — 여기가 판정을 거치는 유일한 통로다. */
const HELPER_INTERNALS = [
  'src/hooks/useFailureReport.ts | message.error(text);',
  // 성공·정보·경고까지 감싸는 범용 래퍼. `error` 는 위 검증 자리들이 쓴다.
  'src/hooks/useMessage.ts | messageApi.error(content, duration);',
];

const LEDGER = [...INPUT_VALIDATION, ...DOMAIN_ANSWER, ...BROWSER_API, ...HELPER_INTERNALS].sort();

const CALL_PATTERN = /(?:^|[^.\w])(?:message|messageApi)\.error\(|(?:^|[^.\w])showError\(/;

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      collectSourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function findRawErrorCalls(): string[] {
  const root = process.cwd();
  const found: string[] = [];

  for (const file of collectSourceFiles(path.join(root, 'src'))) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');

    lines.forEach(line => {
      const trimmed = line.trim();
      // 주석 안의 예시는 호출이 아니다 (sessionExpiry·errorReporting 의 설명문).
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;
      if (!CALL_PATTERN.test(line)) return;
      found.push(`${relative} | ${trimmed}`);
    });
  }

  /**
   * 중복은 접는다 — 같은 가드가 두 진입점에 하나씩 있는 경우(파일 선택 확인)가 실제로
   * 있고, 그건 **같은 결정**이다. 원장이 답해야 하는 질문은 "어떤 종류의 raw 호출이
   * 왜 남아 있는가"이지 "몇 개인가"가 아니다. 개수까지 고정하면 리팩터링 때마다
   * 판단할 것 없는 실패가 난다.
   */
  return [...new Set(found)].sort();
}

describe('실패 보고 원장', () => {
  it('원인을 구분하지 않는 토스트는 헬퍼 밖에 남아 있지 않다', () => {
    /**
     * 이 테스트가 깨졌다면 새 호출이 생긴 것이다. 물을 것은 하나다.
     *
     *   요청이 실패해서 그걸 도메인 언어로 옮겨 적는 중인가?
     *     예   → `useFailureReport()` 의 `reportFailure(text, error)` 로 바꾼다.
     *     아니오 → 위 목록에 이유와 함께 추가한다.
     */
    expect(findRawErrorCalls()).toEqual(LEDGER);
  });

  it('원장에 죽은 항목이 남아 있지 않다', () => {
    // 호출이 지워졌는데 원장만 남으면, 다음 사람이 없는 자리를 근거로 판단하게 된다.
    const actual = new Set(findRawErrorCalls());
    expect(LEDGER.filter(entry => !actual.has(entry))).toEqual([]);
  });
});
