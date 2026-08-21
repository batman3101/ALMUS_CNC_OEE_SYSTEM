/**
 * 알림 문구는 **번역 키**로 만들어져 렌더 시점에 번역된다. 키를 찾지 못하면 i18next 는
 * 예외를 던지지 않고 **키 문자열 자체**를 화면에 렌더한다 — 조용히 실패한다.
 *
 * 실제로 관리자 화면에 `notifications.machineState.BREAKDOWN_REPAIR` 가 그대로 보였다.
 * 키가 없어서가 아니라, 그 키를 `dashboard` 네임스페이스에 묶인 `t` 로 찾았기 때문이다.
 */
import fs from 'fs';
import path from 'path';
import { MACHINE_STATES } from '@/types';

const readJson = (relative: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), relative), 'utf8'));

const readSource = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('설비 상태 알림 문구의 번역 계약', () => {
  const locales = ['ko', 'vi'] as const;

  // 정상 가동은 알림을 만들지 않으므로 문구가 없는 것이 맞다.
  const ALERTING_STATES = MACHINE_STATES.filter(state => state !== 'NORMAL_OPERATION');

  it.each(locales)('%s: 알림 대상 설비 상태에 모두 번역 문구가 있다', locale => {
    const machineState = readJson(`public/locales/${locale}/common.json`)
      .notifications.machineState;

    // 새 설비 상태를 추가하면 이 검사가 번역 추가를 강제한다.
    ALERTING_STATES.forEach(state => {
      expect(typeof machineState[state]).toBe('string');
      expect(machineState[state].length).toBeGreaterThan(0);
    });
    // 알 수 없는 상태로 떨어질 때의 문구도 필요하다.
    expect(typeof machineState.unknown).toBe('string');
  });

  it.each(locales)('%s: 이 키들은 dashboard 네임스페이스에 없다', locale => {
    const dashboard = readJson(`public/locales/${locale}/dashboard.json`);

    // 이것이 `tCommon` 이 필요한 이유다. dashboard 에 묶인 `t` 로는 영영 찾지 못한다.
    expect(dashboard.notifications?.machineState).toBeUndefined();
  });

  it('AdminDashboard 는 알림 문구를 common 네임스페이스로 번역한다', () => {
    const source = readSource('src/components/dashboard/AdminDashboard.tsx');

    expect(source).toMatch(/const \{ t: tCommon \} = useCommonTranslation\(\)/);
    expect(source).toMatch(/message: tCommon\(notification\.messageKey, notification\.messageParams\)/);
    // dashboard 바인딩으로 되돌아가면 화면에 raw 키가 다시 나타난다.
    expect(source).not.toMatch(/message: t\(notification\.messageKey/);
  });
});
