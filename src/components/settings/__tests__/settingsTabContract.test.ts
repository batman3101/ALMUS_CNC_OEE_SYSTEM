/**
 * 설정 탭 5개가 **모두** 같은 계약을 지키는지 검사한다.
 *
 * 감사 2026-08-06 에서 드러난 결함들은 하나같이 "다섯 곳에 똑같이 복제된 실수"였다
 * (미저장 반전, resetFields 되돌리기, `||` 로 인한 0 소실, 비원자적 순차 저장).
 * 한 탭만 고치고 나머지를 놓치면 증상은 그대로 남는다. 그래서 개별 동작 테스트와 별개로
 * **전 탭을 훑는** 계약 검사를 둔다. 새 탭이 추가되면 자동으로 검사 대상이 된다.
 *
 * 소스 문자열 검사는 약한 도구지만, 여기서는 "다섯 파일에 빠짐없이 적용됐는가"라는
 * 파일 횡단 속성을 보기 때문에 적절하다. 각 동작의 진짜 검증은
 * useSettingsFormState.test.tsx 와 shiftEngineConstraint.test.tsx 가 맡는다.
 */
import fs from 'fs';
import path from 'path';

const TABS_DIR = path.join(process.cwd(), 'src', 'components', 'settings', 'tabs');

/** 감사 탭은 읽기 전용이라 저장 폼이 없다 — 계약 대상이 아니다. */
const READ_ONLY_TABS = new Set(['SettingsAuditTab.tsx']);

const tabFiles = fs
  .readdirSync(TABS_DIR)
  .filter(file => file.endsWith('SettingsTab.tsx') && !READ_ONLY_TABS.has(file));

describe('설정 탭 계약', () => {
  it('편집 가능한 탭이 5개 모두 발견된다', () => {
    // 파일명 규칙이 바뀌어 검사가 0개 파일을 훑고도 통과하는 상황을 막는다.
    expect(tabFiles.sort()).toEqual([
      'DisplaySettingsTab.tsx',
      'GeneralSettingsTab.tsx',
      'NotificationSettingsTab.tsx',
      'OEESettingsTab.tsx',
      'ShiftSettingsTab.tsx',
    ]);
  });

  describe.each(tabFiles)('%s', file => {
    const source = fs.readFileSync(path.join(TABS_DIR, file), 'utf-8');

    it('미저장 상태를 입력 시점에 보고한다 (저장 시점이 아니라)', () => {
      // 예전 계약: onSettingsChange?.() 를 **저장 성공 후에만** 호출 → 부모가 dirty=true.
      // 저장하면 미저장 배지가 켜지고, 편집만 하면 아무 경고가 없었다.
      expect(source).not.toContain('onSettingsChange');
      expect(source).toContain('onDirtyChange');
      expect(source).toContain('onValuesChange={markDirty}');
    });

    it('되돌리기가 저장된 스냅샷을 복원한다 (form.resetFields 로 비우지 않는다)', () => {
      expect(source).toContain('onClick={revertToSaved}');
      // resetFields() 는 훅 내부에서 검증 상태 정리 용도로만 쓴다. 탭에서 직접 부르면
      // <Form initialValues> 가 없는 이 폼들에서는 값이 빈 값이 된다.
      expect(source).not.toMatch(/onClick=\{\(\)\s*=>\s*form\.resetFields\(\)\}/);
    });

    it('저장이 원자적이다 (키별 순차 저장이 아니다)', () => {
      // 예전: for (const update of updates) { await updateSetting(...) }
      // 중간 실패 시 앞쪽 키만 DB 에 남고 화면은 전체 실패로 표시한다.
      expect(source).toContain('updateSettingsAtomic');
      expect(source).not.toMatch(/for\s*\(const update of updates\)/);
    });

    it('서버 값을 `||` 로 채우지 않는다 (저장된 0/false/"" 를 지키기 위해)', () => {
      const hydrateBlock = source.match(/hydrate\(\{[\s\S]*?\n\s*\}\);/);
      expect(hydrateBlock).not.toBeNull();

      // 주석에서 `||` 를 걷어낸다 — 이 결함을 **설명하는** 주석에는 `||` 가 반드시 등장한다.
      // 주석을 세면 올바르게 고친 파일이 오히려 실패한다.
      const code = hydrateBlock![0]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      // `??` 든 resolve* 헬퍼(resolveBreakMinutes 등)든 null 과 0 을 구분하기만 하면 된다.
      // 금지되는 것은 저장된 0/false/'' 를 코드 기본값으로 덮어쓰는 `||` 하나뿐이다.
      expect(code).not.toContain('||');
    });
  });
});
