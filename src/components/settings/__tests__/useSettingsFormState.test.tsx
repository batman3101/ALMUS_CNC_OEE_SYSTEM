/**
 * 설정 탭의 "미저장 상태"와 "되돌리기" 계약 회귀 검사.
 *
 * 감사 2026-08-06 의 MEDIUM-01 / MEDIUM-02 를 고정한다. 두 결함 모두 **저장은 성공하는데
 * 화면이 거짓말을 하는** 종류라 기존 861개 테스트가 전부 통과하면서도 살아남았다.
 *
 * ⚠️ 이 파일의 테스트는 **관찰 가능한 결과**만 본다. "getter 가 호출됐다" 같은 검사는
 *    깨진 코드에서도 통과하므로 쓰지 않는다 (failureReportLedger.test.ts 의 교훈).
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { Form, Input } from 'antd';
import { useSettingsFormState } from '../useSettingsFormState';

interface HarnessProps {
  onDirtyChange: (dirty: boolean) => void;
  /** 서버에서 읽어온 값. 바뀌면 hydrate 가 다시 돈다. */
  loaded?: { company_name: string } | null;
}

/**
 * 실제 탭들과 같은 방식으로 훅을 쓰는 최소 harness.
 * antd Form + useEffect(hydrate) + onValuesChange(markDirty) + 저장/되돌리기 버튼.
 */
const Harness: React.FC<HarnessProps> = ({ onDirtyChange, loaded }) => {
  const [form] = Form.useForm();
  const { hydrate, markSaved, markDirty, revertToSaved, canRevert } =
    useSettingsFormState<{ company_name: string }>(form, onDirtyChange);

  React.useEffect(() => {
    if (loaded) hydrate(loaded);
  }, [loaded, hydrate]);

  return (
    <Form form={form} onValuesChange={markDirty}>
      <Form.Item name="company_name">
        <Input aria-label="company_name" />
      </Form.Item>
      <button type="button" onClick={() => markSaved(form.getFieldsValue())}>save</button>
      <button type="button" onClick={revertToSaved} disabled={!canRevert}>revert</button>
    </Form>
  );
};

describe('useSettingsFormState', () => {
  const LOADED = { company_name: 'ALMUS TECH' };

  it('편집하면 미저장이 켜지고, 저장하면 꺼진다 (예전에는 정확히 반대였다)', () => {
    const onDirtyChange = jest.fn();
    render(<Harness onDirtyChange={onDirtyChange} loaded={LOADED} />);

    // 로드 자체는 사용자의 편집이 아니다.
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);

    fireEvent.change(screen.getByLabelText('company_name'), { target: { value: 'ALMUS TECH X' } });
    expect(onDirtyChange).toHaveBeenCalledWith(true);

    onDirtyChange.mockClear();
    fireEvent.click(screen.getByText('save'));

    // 예전 구현은 저장 성공 시 onSettingsChange() 를 불렀고 부모가 그걸 dirty=true 로 받았다.
    // 저장이 미저장 상태를 **켜는** 것이 이 결함의 본체다.
    expect(onDirtyChange).toHaveBeenCalledWith(false);
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });

  it('되돌리기는 마지막으로 로드된 값을 복원한다 (빈 폼이 아니다)', () => {
    render(<Harness onDirtyChange={jest.fn()} loaded={LOADED} />);

    const input = screen.getByLabelText('company_name') as HTMLInputElement;
    expect(input.value).toBe('ALMUS TECH');

    fireEvent.change(input, { target: { value: '다른 회사' } });
    expect(input.value).toBe('다른 회사');

    fireEvent.click(screen.getByText('revert'));

    // 예전 구현은 form.resetFields() 만 불렀다. <Form initialValues> 가 없으므로 값이
    // 빈 문자열이 되고, settings 는 그대로라 채우던 useEffect 도 다시 돌지 않았다.
    // 관리자는 그 빈 값을 "저장된 값"으로 오인한 채 저장을 누를 수 있었다.
    expect(input.value).toBe('ALMUS TECH');
  });

  it('되돌리기 후에는 미저장이 해제된다', () => {
    const onDirtyChange = jest.fn();
    render(<Harness onDirtyChange={onDirtyChange} loaded={LOADED} />);

    fireEvent.change(screen.getByLabelText('company_name'), { target: { value: 'X' } });
    onDirtyChange.mockClear();

    fireEvent.click(screen.getByText('revert'));
    expect(onDirtyChange).toHaveBeenCalledWith(false);
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });

  it('설정을 아직 못 읽었으면 되돌리기 버튼이 비활성이다', () => {
    render(<Harness onDirtyChange={jest.fn()} loaded={null} />);
    // 되돌릴 스냅샷이 없는데 버튼이 눌리면 폼이 비워지고, 그 빈 값이 저장된 값처럼 보인다.
    expect(screen.getByText('revert')).toBeDisabled();
  });

  it('부모가 콜백을 매 렌더 새로 넘겨도 hydrate 가 재실행되지 않는다', () => {
    // 부모는 onDirtyChange 를 인라인 화살표로 넘긴다. 훅이 그 identity 를 그대로
    // 의존성에 쓰면 hydrate 가 매 렌더 새로 만들어지고, 탭의 useEffect([loaded, hydrate])
    // 가 끝없이 재실행된다(무한 렌더). ref 고정이 그걸 막는지 본다.
    const hydrateCalls: number[] = [];
    const Counter: React.FC = () => {
      const [form] = Form.useForm();
      const [, forceRender] = React.useState(0);
      // 매 렌더 새 함수 — 실제 부모와 같은 조건
      const { hydrate } = useSettingsFormState<{ company_name: string }>(form, () => {});
      React.useEffect(() => {
        hydrateCalls.push(1);
        hydrate({ company_name: 'ALMUS TECH' });
      }, [hydrate]);
      return (
        <Form form={form}>
          <button type="button" onClick={() => forceRender(n => n + 1)}>rerender</button>
        </Form>
      );
    };

    render(<Counter />);
    const afterMount = hydrateCalls.length;

    act(() => {
      fireEvent.click(screen.getByText('rerender'));
    });

    expect(hydrateCalls.length).toBe(afterMount);
  });
});
