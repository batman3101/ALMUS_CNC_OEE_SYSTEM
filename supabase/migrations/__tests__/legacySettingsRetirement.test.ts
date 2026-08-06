import fs from 'fs';
import path from 'path';

import { SETTINGS_CONTRACT_IDS, isContractKey, settingContractId } from '@/lib/settingsRegistry';

/**
 * 레거시 설정 키 은퇴 규약 테스트.
 *
 * ## 무엇이 실제로 위험한가
 *
 * 설정 키를 은퇴시키는 마이그레이션에서 다칠 수 있는 방법은 사실상 하나다 — **앱이 아직 읽는
 * 키를 같이 꺼 버리는 것.** 읽는 쪽은 전부 `is_active = true` 로 거르므로
 * (`src/lib/systemSettings.ts`, `api/system-settings/service-role`), 계약 키 하나가 목록에
 * 섞여 들어가면 그 설정은 **오류 없이 조용히 기본값으로 되돌아간다.** `break_time_minutes`
 * 하나만 그렇게 돼도 `/api/production-progress` 가 `break_config_matches: false` 로 안전 중단해
 * 전 설비의 실시간 지표가 사라진다.
 *
 * 그래서 이 테스트는 마이그레이션의 SQL 을 읽고, 계약(`settingsRegistry.ts`)을 import 해서,
 * **두 집합이 겹치지 않는지**를 본다. 어느 쪽이 나중에 바뀌어도 검사는 계속 성립한다.
 *
 * ## 왜 파일 하나를 지정하지 않는가
 *
 * `machineStateLockProtocol.test.ts` 와 같은 이유다. 마이그레이션 전체를 훑어 "설정 키를
 * 비활성화하는 파일"을 스스로 찾아내므로, 다음에 누가 또 키를 은퇴시키면 이 파일을 고치지
 * 않아도 자동으로 검사 대상이 된다. 규약은 개별 마이그레이션의 속성이 아니라 집합 전체의
 * 속성이고, 집합을 열거하는 테스트만이 빠진 원소를 찾아낸다.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase/migrations');

/** `system_settings` 의 행을 비활성화하는 파일인가. 이 신호가 곧 검사 대상 선정 기준이다. */
const DEACTIVATES_SETTINGS =
  /update\s+(?:public\.)?system_settings\b[\s\S]{0,400}?is_active\s*=\s*false/i;

/** 열거된 `('category', 'key')` 쌍. 마이그레이션은 쌍을 **직접 나열**해야 한다(아래 참조). */
const PAIR = /\(\s*'([a-z_]+)'\s*,\s*'([a-z0-9_]+)'\s*\)/gi;

/**
 * SQL 주석을 걷어낸다. 이 저장소의 마이그레이션은 주석이 본문보다 긴 경우가 많고, 은퇴 시점의
 * 값을 적어 둔 표에도 키 이름이 나온다. 주석에서 쌍을 주워 오면 "무엇을 실제로 끄는가"가 아니라
 * "무엇을 설명하는가"를 검사하게 된다.
 */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

interface RetirementFile {
  file: string;
  pairs: string[];
}

function collectRetirementFiles(): RetirementFile[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .map(file => ({
      file,
      sql: stripComments(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')),
    }))
    .filter(entry => DEACTIVATES_SETTINGS.test(entry.sql))
    .map(entry => {
      const pairs: string[] = [];
      for (const match of entry.sql.matchAll(PAIR)) {
        pairs.push(settingContractId(match[1], match[2]));
      }
      return { file: entry.file, pairs: [...new Set(pairs)].sort() };
    });
}

/** 이 마이그레이션이 은퇴시키는 11개. 목록 자체가 바뀌면 알아채야 하므로 명시적으로 적는다. */
const EXPECTED_RETIRED = [
  'display.refresh_interval',
  'display.theme',
  'general.test_setting',
  'notification.email_enabled',
  'oee.availability_target',
  'oee.oee_target_percentage',
  'oee.performance_target',
  'oee.quality_target',
  'shift.shift_a_end',
  'shift.shift_b_end',
  'ui.language',
].sort();

describe('레거시 설정 키 은퇴 규약', () => {
  const retirementFiles = collectRetirementFiles();
  const allRetired = [...new Set(retirementFiles.flatMap(entry => entry.pairs))].sort();

  it('설정 키를 은퇴시키는 마이그레이션을 실제로 찾아낸다 (탐지기가 죽지 않았는지)', () => {
    // 정규식이 망가져 0건이 되면 아래 규약 테스트가 **아무것도 검사하지 않고 통과**한다.
    // 빈 배열의 filter 는 언제나 빈 배열이라 expect([]).toEqual([]) 가 성립하기 때문이다.
    // 그 조용한 실패를 먼저 막는다.
    expect(retirementFiles.map(entry => entry.file)).toEqual(
      expect.arrayContaining(['20260806030000_deactivate_legacy_settings_keys.sql'])
    );
  });

  it('은퇴시키는 파일은 반드시 키 쌍을 열거한다', () => {
    // 쌍을 하나도 뽑아내지 못한 파일은 "안전하다"가 아니라 "읽지 못했다"이다. 다음 사람이
    // 다른 모양(예: setting_key 만으로 매칭, 또는 계약 밖 전부를 끄는 일반 술어)으로 쓰면
    // 여기서 걸린다 — 조용히 통과하는 것보다 낫다.
    const unparsed = retirementFiles.filter(entry => entry.pairs.length === 0).map(entry => entry.file);
    expect(unparsed).toEqual([]);
  });

  it('은퇴시키는 키는 현행 계약과 겹치지 않는다', () => {
    // 이 테스트가 이 파일의 존재 이유다. 앱이 아직 읽는 키를 끄면 그 설정은 오류 없이
    // 기본값으로 되돌아간다 — 가장 조용하고 가장 아픈 실패다.
    const collisions = allRetired.filter(id => {
      const [category, ...rest] = id.split('.');
      return isContractKey(category, rest.join('.'));
    });

    expect(collisions).toEqual([]);
  });

  it('계약을 실제로 읽어 왔다 (계약 쪽 탐지기가 죽지 않았는지)', () => {
    // `SETTINGS_CONTRACT_IDS` 가 어떤 이유로든 빈 배열이 되면 아래 "반대 방향" 검사가
    // **아무것도 검사하지 않고 통과**한다. 개수를 여기에 못박지는 않는다 — 계약은 자라는
    // 물건이고(2026-08-06 하루에만 32 → 35), 숫자를 적으면 계약이 자랄 때마다 갱신해야 하는
    // 자리가 하나 더 생긴다. 그건 이 정리 작업이 치우고 있는 결함과 같은 종류다.
    expect(SETTINGS_CONTRACT_IDS.length).toBeGreaterThan(0);
    // 형태도 확인한다. 전부 `category.key` 꼴이어야 아래 집합 연산이 의미를 갖는다.
    expect(SETTINGS_CONTRACT_IDS.every(id => /^[a-z_]+\.[a-z0-9_]+$/.test(id))).toBe(true);
  });

  it('반대 방향도 성립한다 — 계약 키 중 은퇴 목록에 든 것이 없다', () => {
    // 위 검사와 같은 성질을 계약 쪽에서 확인한다. 한쪽 함수(`isContractKey`)가 망가져도
    // 다른 쪽이 잡는다.
    const retiredSet = new Set(allRetired);
    expect(SETTINGS_CONTRACT_IDS.filter(id => retiredSet.has(id))).toEqual([]);
  });

  it('은퇴 목록이 2026-08-06 실측한 11개 그대로다', () => {
    expect(allRetired).toEqual(EXPECTED_RETIRED);
  });

  describe('20260806030000_deactivate_legacy_settings_keys.sql', () => {
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20260806030000_deactivate_legacy_settings_keys.sql'),
      'utf8'
    );
    const body = stripComments(sql);

    it('행을 지우지 않는다 — 비활성화만 한다', () => {
      // DELETE 는 되돌릴 수 없고 감사 이력의 참조 대상도 사라진다. 이 표는 이미
      // `shift.shift_hours` 로 "은퇴 = is_active false" 전례를 만들었다.
      expect(body).not.toMatch(/delete\s+from\s+(?:public\.)?system_settings/i);
      expect(body).toMatch(/is_active\s*=\s*false/i);
    });

    it('재실행해도 안전하다', () => {
      // 이미 꺼진 행을 다시 건드리지 않아야 두 번째 적용이 updated_at 을 흔들지 않는다.
      expect(body).toMatch(/is_active\s+is\s+distinct\s+from\s+false/i);
    });

    it('category 와 setting_key 를 함께 본다', () => {
      // setting_key 는 전역 UNIQUE 라 단독으로도 행이 특정되지만, 카테고리를 함께 적어야
      // 목록이 사람 눈에 계약과 대조 가능한 형태로 남는다.
      expect(body).toMatch(/s\.category\s*=\s*l\.category/i);
      expect(body).toMatch(/s\.setting_key\s*=\s*l\.setting_key/i);
    });

    it('"계약에 없는 키 전부" 같은 일반 술어를 쓰지 않는다', () => {
      // 계약은 TypeScript 에 있고 SQL 은 그것을 볼 수 없다. 일반 술어는 이 마이그레이션보다
      // 늦게 추가되는 새 키까지 끈다.
      expect(body).not.toMatch(/setting_key\s+not\s+in/i);
      expect(body).not.toMatch(/category\s+not\s+in/i);
    });
  });
});
