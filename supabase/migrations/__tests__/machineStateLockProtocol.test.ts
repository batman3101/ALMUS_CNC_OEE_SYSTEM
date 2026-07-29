import fs from 'fs';
import path from 'path';

/**
 * 설비 상태 잠금 규약 테스트.
 *
 * 이 파일은 **특정 마이그레이션 하나를 검사하지 않는다.** 마이그레이션 전체를 시간순으로
 * 훑어 각 함수의 **최종 정의**를 구성한 뒤, "설비 단위 상태를 쓰는 함수는 모두 같은 키의
 * advisory lock 을 먼저 잡는다"는 규약을 강제한다.
 *
 * 함수 하나씩 검사하는 테스트로는 이 결함을 막지 못했을 것이다. 실제로 andon RPC 와 정정 RPC
 * 에는 각각 `pg_advisory_xact_lock` 을 확인하는 테스트가 있었지만, apply_machine_update 에는
 * 그런 테스트가 없었고 — **아무도 그 부재를 눈치채지 못했다.** 규약은 개별 함수의 속성이 아니라
 * 집합 전체의 속성이라서, 집합을 열거하는 테스트만이 빠진 원소를 찾아낸다.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase/migrations');

// 나머지 함수들이 이미 쓰고 있는 키. 키가 다르면 잠금은 서로를 차단하지 못한다.
const CANONICAL_LOCK =
  /pg_advisory_xact_lock\(\s*hashtextextended\(\s*p_machine_id::text\s*,\s*0\s*\)\s*\)/i;

// 설비 단위 상태로 취급하는 쓰기. 이 중 하나라도 하면 잠금 규약의 대상이다.
const MACHINE_STATE_WRITE =
  /\b(?:update\s+(?:public\.)?machines\b|(?:insert\s+into|update)\s+(?:public\.)?downtime_entries\b)/i;

/**
 * 잠금을 잡지 않아도 되는 함수와 그 이유.
 * 이유 없이 목록에 넣지 않는다 — 이유를 적을 수 없으면 그건 예외가 아니라 결함이다.
 */
const EXEMPT: Record<string, string> = {
  // 트리거 함수는 자신을 발동시킨 UPDATE 의 트랜잭션 안에서 실행된다. 잠금은 그 UPDATE 를
  // 실행한 쪽이 이미 잡고 있어야 하며, 트리거가 다시 잡을 필요도 잡을 방법도 없다
  // (p_machine_id 가 없고 NEW.id 를 쓴다).
  log_machine_status_change: '트리거 — 호출자의 트랜잭션/잠금 안에서 실행된다',
  close_machine_activity_on_deactivation: '트리거 — 호출자의 트랜잭션/잠금 안에서 실행된다',
};

interface FunctionChunk {
  name: string;
  file: string;
  body: string;
}

/**
 * 마이그레이션 전체에서 함수 정의 덩어리를 뽑아 이름 -> 최종 정의로 접는다.
 * 파일을 시간순(파일명 = 타임스탬프)으로 훑으므로 나중 파일이 앞선 정의를 덮어쓴다.
 * = 운영에 실제로 남아 있는 정의와 같은 모양이 된다.
 */
function collectLatestFunctionDefinitions(): Map<string, FunctionChunk> {
  const latest = new Map<string, FunctionChunk>();
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const header = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;

    const starts: Array<{ name: string; index: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = header.exec(sql)) !== null) {
      starts.push({ name: match[1].toLowerCase(), index: match.index });
    }

    starts.forEach((start, i) => {
      // 다음 함수 정의 직전까지가 이 함수의 몸통이다 (사이의 grant/revoke 는 무해하다).
      const end = i + 1 < starts.length ? starts[i + 1].index : sql.length;
      latest.set(start.name, {
        name: start.name,
        file,
        body: sql.slice(start.index, end),
      });
    });
  }

  return latest;
}

describe('설비 상태 잠금 규약', () => {
  const definitions = collectLatestFunctionDefinitions();

  const stateWriters = [...definitions.values()].filter(
    fn => MACHINE_STATE_WRITE.test(fn.body) && !(fn.name in EXEMPT)
  );

  it('상태를 쓰는 함수를 실제로 찾아낸다 (탐지기 자체가 죽지 않았는지)', () => {
    // 정규식이 망가져 0건이 되면 아래 규약 테스트가 **아무것도 검사하지 않고 통과**한다.
    // 빈 배열에 대한 filter 는 언제나 빈 배열이라 expect([]).toEqual([]) 가 성립하기 때문이다.
    // 그 조용한 실패를 먼저 막는다.
    //
    // 목록은 "적어도 이건 있어야 한다"이지 "이게 전부"가 아니다. 새 함수가 상태를 쓰기 시작하면
    // 여기를 고치지 않아도 아래 규약 테스트가 알아서 그 함수를 검사한다 — 그게 이 테스트의 목적이다.
    // (correct_open_downtime_reason 은 feature/claude-2026-07-28-downtime-visibility 가 들여온다.
    //  병합되는 순간 자동으로 검사 대상이 되며, 규약을 어기면 그때 이 테스트가 막는다.)
    const names = stateWriters.map(fn => fn.name).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        'apply_machine_update',
        'toggle_machine_downtime',
        'upsert_downtime_entry',
      ])
    );
  });

  it('상태를 쓰는 모든 함수가 같은 키의 advisory lock 을 잡는다', () => {
    const missing = stateWriters
      .filter(fn => !CANONICAL_LOCK.test(fn.body))
      .map(fn => `${fn.name} (${fn.file})`);

    expect(missing).toEqual([]);
  });

  it('잠금을 첫 쓰기보다 먼저 잡는다', () => {
    // 쓴 다음에 잠그는 것은 잠그지 않는 것과 같다.
    const outOfOrder = stateWriters
      .map(fn => ({
        fn,
        lockAt: fn.body.search(CANONICAL_LOCK),
        writeAt: fn.body.search(MACHINE_STATE_WRITE),
      }))
      .filter(item => item.lockAt < 0 || item.lockAt > item.writeAt)
      .map(item => `${item.fn.name} (lock@${item.lockAt} > write@${item.writeAt})`);

    expect(outOfOrder).toEqual([]);
  });

  it('면제 목록에는 트리거 함수만 있고, 각각 이유가 적혀 있다', () => {
    for (const [name, reason] of Object.entries(EXEMPT)) {
      expect(reason.length).toBeGreaterThan(10);
      const fn = definitions.get(name);
      expect(fn).toBeDefined();
      // 트리거 함수임을 실제 정의로 확인한다 (면제가 슬그머니 일반 함수로 넘어가지 않도록).
      expect(fn!.body).toMatch(/returns\s+trigger/i);
    }
  });

  it('잠금 없는 옛 4-인자 apply_machine_update 는 남겨 두지 않는다', () => {
    // create or replace 는 인자 목록이 다르면 **덮어쓰지 않고 오버로드를 만든다.**
    // 옛 버전이 살아 있으면 잠금 없는 경로가 그대로 호출될 수 있다.
    const migration = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20260729030000_machine_state_lock_protocol.sql'),
      'utf8'
    );
    expect(migration).toMatch(
      /drop\s+function\s+if\s+exists\s+public\.apply_machine_update\(uuid,\s*jsonb,\s*text,\s*uuid\)/i
    );
  });

  it('비활성 설비 판단이 잠금 안에서 이뤄진다', () => {
    const fn = definitions.get('apply_machine_update')!;
    const lockAt = fn.body.search(CANONICAL_LOCK);
    const guardAt = fn.body.search(/if\s+p_require_active\s+and\s+not\s+v_new_active/i);
    const writeAt = fn.body.search(/update\s+public\.machines\s+m/i);

    expect(guardAt).toBeGreaterThan(lockAt);
    expect(guardAt).toBeLessThan(writeAt);
    // upsert_downtime_entry 와 같은 오류 코드를 써야 라우트의 409 매핑을 그대로 쓸 수 있다.
    expect(fn.body).toMatch(/raise\s+exception\s+'MACHINE_INACTIVE'\s+using\s+errcode\s*=\s*'55000'/i);
  });

  it('기본값은 false 라 관리자 경로(PUT)의 동작이 바뀌지 않는다', () => {
    const fn = definitions.get('apply_machine_update')!;
    expect(fn.body).toMatch(/p_require_active\s+boolean\s+default\s+false/i);
  });
});
