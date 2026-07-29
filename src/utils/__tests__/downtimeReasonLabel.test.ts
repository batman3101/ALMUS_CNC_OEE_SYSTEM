import { resolveDowntimeReasonLabel } from '@/utils/downtimeReasonLabel';

// i18next 의 t 를 흉내낸다. 사전에 있으면 번역을, 없으면 defaultValue 를 돌려준다.
const makeT = (dict: Record<string, string>) =>
  ((key: string, options?: { defaultValue?: string }) =>
    dict[key] ?? options?.defaultValue ?? key) as never;

const DICT = {
  'machines:states.INSPECTION': '점검중',
  'machines:states.BREAKDOWN_REPAIR': '고장수리',
  'dataInput:downtime.reasons.equipmentFailure': '설비 고장',
  'dataInput:downtime.reasons.endmillChange': 'ENDMILL 교체',
};

describe('resolveDowntimeReasonLabel', () => {
  it('andon 어휘(UPPER_SNAKE)를 machines:states 에서 찾는다', () => {
    expect(resolveDowntimeReasonLabel('INSPECTION', makeT(DICT))).toBe('점검중');
  });

  it('입력폼 어휘(camelCase)를 dataInput:downtime.reasons 에서 찾는다', () => {
    expect(resolveDowntimeReasonLabel('endmillChange', makeT(DICT))).toBe('ENDMILL 교체');
  });

  it('두 사전 어디에도 없으면 원본 코드를 그대로 노출한다', () => {
    expect(resolveDowntimeReasonLabel('someNewCode', makeT(DICT))).toBe('someNewCode');
  });

  it('빈 사유는 원본을 그대로 돌려준다(빈 라벨을 만들지 않는다)', () => {
    expect(resolveDowntimeReasonLabel('', makeT(DICT))).toBe('');
  });

  it('번역 키 원문이 화면으로 새지 않는다', () => {
    const label = resolveDowntimeReasonLabel('unknownThing', makeT(DICT));
    expect(label).not.toContain('machines:');
    expect(label).not.toContain('dataInput:');
    expect(label).not.toContain('states.');
  });
});
