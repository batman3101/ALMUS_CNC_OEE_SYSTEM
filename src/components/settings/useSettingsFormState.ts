'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormInstance } from 'antd';

/**
 * 설정 탭 5개가 공유하는 "저장된 값 스냅샷 + 미저장 상태" 관리.
 *
 * 이 훅이 생긴 이유는 두 가지 결함이 다섯 곳에 똑같이 복제돼 있었기 때문이다
 * (시스템 설정 적용성 감사 2026-08-06, MEDIUM-01 / MEDIUM-02).
 *
 * ① **미저장 감지가 정확히 반대로 동작했다.** 각 탭은 입력이 바뀔 때가 아니라
 *    **저장에 성공한 뒤** `onSettingsChange()` 를 불렀고, 부모는 그걸
 *    `setHasUnsavedChanges(true)` 로 받았다. 그래서 편집만 하고 탭을 옮기면 아무 경고가
 *    없었고, 저장을 끝내면 오히려 "저장되지 않은 변경사항이 있습니다" 가 켜졌다.
 *    경고가 신호가 아니라 잡음이 되면 관리자는 경고를 읽지 않게 되고, 그때부터는
 *    경고가 있으나 없으나 같다 — 진짜 미저장 편집이 조용히 사라진다.
 *
 * ② **탭별 `초기화` 가 "저장된 값 복원"을 보장하지 않았다.** 탭들은 비동기 로드 후
 *    `setFieldsValue()` 로 폼을 채우는데, 초기화 버튼은 `form.resetFields()` 만 불렀다.
 *    antd 의 `resetFields()` 는 `<Form initialValues>` 로 되돌리는데 그 prop 이 없으므로
 *    필드가 **빈 값**이 된다. 게다가 `settings` 는 그대로라 채우던 useEffect 도 다시 돌지
 *    않는다. 관리자는 빈 폼을 "저장된 값"으로 오인한 채 저장을 누를 수 있었다.
 *
 * 그래서 되돌리기의 목표값은 `initialValues` 도 코드 기본값도 아닌 **마지막으로 로드/저장된
 * 실제 값**이다. 그 값을 여기서 한 곳에만 보관한다.
 */
export interface SettingsFormState<T> {
  /** 서버에서 읽어온 값으로 폼을 채우고, 그 값을 "저장된 값"으로 기록한다. */
  hydrate: (values: T) => void;
  /** 저장 성공 후 호출. 스냅샷을 갱신하고 미저장 상태를 해제한다. */
  markSaved: (values: T) => void;
  /** 입력이 바뀔 때 호출 (`<Form onValuesChange>`). */
  markDirty: () => void;
  /** 마지막으로 로드/저장된 값으로 폼을 되돌린다. */
  revertToSaved: () => void;
  /** 되돌릴 스냅샷이 있는지. 없으면 버튼을 비활성화해 "빈 폼 = 저장된 값" 오인을 막는다. */
  canRevert: boolean;
}

export function useSettingsFormState<T extends Record<string, unknown>>(
  form: FormInstance,
  onDirtyChange?: (dirty: boolean) => void,
): SettingsFormState<T> {
  const savedValuesRef = useRef<T | null>(null);
  const [canRevert, setCanRevert] = useState(false);

  // 부모는 이 콜백을 인라인 화살표로 넘긴다 → 매 렌더마다 새 identity.
  // 그대로 useCallback 의존성에 넣으면 hydrate 도 매 렌더 새로 만들어지고,
  // 탭의 `useEffect([settings, hydrate])` 가 끝없이 재실행된다.
  // 같은 함정을 useThemeSettings.ts 가 이미 주석으로 남겨 두었다 — ref 로 고정한다.
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });

  const setDirty = useCallback((dirty: boolean) => {
    onDirtyChangeRef.current?.(dirty);
  }, []);

  const rememberSnapshot = useCallback((values: T) => {
    savedValuesRef.current = values;
    setCanRevert(true);
  }, []);

  const hydrate = useCallback((values: T) => {
    rememberSnapshot(values);
    form.setFieldsValue(values);
    // 서버 값으로 채우는 것은 사용자의 편집이 아니다. antd 의 setFieldsValue 는
    // onValuesChange 를 발생시키지 않지만, 로드가 저장 뒤에 다시 일어나는 경우를 대비해
    // 여기서도 명시적으로 해제한다.
    setDirty(false);
  }, [form, rememberSnapshot, setDirty]);

  const markSaved = useCallback((values: T) => {
    rememberSnapshot(values);
    setDirty(false);
  }, [rememberSnapshot, setDirty]);

  const markDirty = useCallback(() => {
    setDirty(true);
  }, [setDirty]);

  const revertToSaved = useCallback(() => {
    const saved = savedValuesRef.current;
    // 스냅샷이 없다는 것은 설정을 한 번도 못 읽었다는 뜻이다. 그 상태에서 폼을 비우면
    // 빈 값이 곧 "저장된 값"처럼 보인다 — 되돌릴 게 없으면 아무것도 하지 않는다.
    if (!saved) return;

    // ⚠️ `form.resetFields()` 를 먼저 부르면 안 된다.
    //
    // 이 폼들에는 `<Form initialValues>` 가 없다(값이 비동기로 온다). 그래서 resetFields() 는
    // 각 필드를 `undefined` 로 만드는데, 제어 컴포넌트에 `value={undefined}` 가 들어가면
    // React 는 그 입력을 **비제어**로 전환하고 DOM 의 기존 문자열을 그대로 둔다. 뒤이어
    // setFieldsValue 로 스토어를 되돌려도 화면의 글자는 사용자가 방금 친 값에 머문다.
    // (이 회귀는 useSettingsFormState.test.tsx 의 "되돌리기는 마지막으로 로드된 값을
    //  복원한다" 가 실제로 잡아냈다 — 되돌렸는데 편집값이 남아 있었다.)
    //
    // 값은 스냅샷으로 직접 덮고, 검증 에러만 따로 지운다.
    form.setFieldsValue(saved);
    form.setFields(Object.keys(saved).map(name => ({ name, errors: [] })));
    setDirty(false);
  }, [form, setDirty]);

  return { hydrate, markSaved, markDirty, revertToSaved, canRevert };
}
