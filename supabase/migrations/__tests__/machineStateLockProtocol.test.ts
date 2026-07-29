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

/**
 * `machines` 를 행 잠금과 함께 읽는가.
 *
 * advisory lock 은 **RPC 끼리만** 상호 배제한다. RPC 를 거치지 않고 machines 를 직접
 * UPDATE 하는 경로(관리자 설비 비활성화 2곳)에는 아무 효력이 없다 — Node 문장 하나는
 * 트랜잭션 범위 advisory lock 을 잡을 수 없기 때문이다.
 *
 * FOR UPDATE 로 읽으면 튜플의 xmax 가 이 트랜잭션으로 표시되고, 동시에 들어온 UPDATE 는
 * 그 xid 를 보고 커밋까지 대기한다. 그래야 판단과 쓰기 사이가 비지 않는다.
 */
const MACHINES_ROW_LOCK = /from\s+(?:public\.)?machines\b[\s\S]{0,200}?for\s+update/i;

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

  it('machines 를 행 잠금과 함께 읽는다', () => {
    // advisory lock 만으로는 RPC 를 거치지 않는 writer 를 막지 못한다.
    // 실제로 관리자 설비 비활성화(DELETE 라우트 2곳)가 그런 writer 이고, 이 잠금이 없으면
    // andon·정정의 판단과 쓰기 사이로 끼어들어 0초 유령 행과 상태 불일치를 남긴다.
    const missing = stateWriters
      .filter(fn => !MACHINES_ROW_LOCK.test(fn.body))
      .map(fn => `${fn.name} (${fn.file})`);

    expect(missing).toEqual([]);
  });

  it('행 잠금을 첫 쓰기보다 먼저 잡는다', () => {
    const outOfOrder = stateWriters
      .map(fn => ({
        fn,
        readAt: fn.body.search(MACHINES_ROW_LOCK),
        writeAt: fn.body.search(MACHINE_STATE_WRITE),
      }))
      .filter(item => item.readAt < 0 || item.readAt > item.writeAt)
      .map(item => `${item.fn.name} (read@${item.readAt} > write@${item.writeAt})`);

    expect(outOfOrder).toEqual([]);
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

  it('전방 호환이다 — 시그니처를 바꾸지 않고 함수를 DROP 하지 않는다', () => {
    // 인자를 늘리면 create or replace 가 **덮어쓰지 않고 오버로드를 만들어**, 잠금 없는 옛
    // 버전이 살아남는다. 그래서 DROP 이 필요해지고, DROP 하는 순간 마이그레이션과 코드 배포
    // 사이에 "함수 없음" 창이 생긴다(PostgREST 스키마 캐시 지연까지 겹친다).
    // 이 마이그레이션은 4-인자 시그니처를 유지해 그 창을 없앤다 — 코드보다 먼저 적용해도 안전하다.
    const migration = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20260729030000_machine_state_lock_protocol.sql'),
      'utf8'
    );

    expect(migration).not.toMatch(/drop\s+function[\s\S]{0,80}apply_machine_update/i);

    // 인자 목록을 통째로 뽑아 이름만 비교한다 (줄바꿈·들여쓰기·기본값에 흔들리지 않게).
    const signature = /create\s+or\s+replace\s+function\s+public\.apply_machine_update\(([^)]*)\)/i
      .exec(migration);
    expect(signature).not.toBeNull();
    const paramNames = signature![1]
      .split(',')
      .map(part => part.trim().split(/\s+/)[0])
      .filter(Boolean);
    // 호출자를 구분하는 인자(p_require_active 등)가 붙으면 여기서 걸린다.
    // 파일 전체에서 그 이름을 금지하지는 않는다 — 왜 그 설계를 버렸는지 설명하는 주석에도
    // 그 이름이 나오고, 그 설명은 남아 있어야 한다.
    expect(paramNames).toEqual(['p_machine_id', 'p_updates', 'p_change_reason', 'p_changed_by']);
  });

  it('비활성 설비 판단이 잠금 안에서, 쓰기보다 먼저 이뤄진다', () => {
    const fn = definitions.get('apply_machine_update')!;
    const lockAt = fn.body.search(CANONICAL_LOCK);
    const guardAt = fn.body.search(/if\s+v_state_changed\s+and\s+not\s+v_new_active/i);
    const writeAt = fn.body.search(/update\s+public\.machines\s+m/i);

    expect(guardAt).toBeGreaterThan(lockAt);
    expect(guardAt).toBeLessThan(writeAt);
    // upsert_downtime_entry 와 같은 오류 코드를 써야 라우트의 409 매핑을 그대로 쓸 수 있다.
    expect(fn.body).toMatch(/raise\s+exception\s+'MACHINE_INACTIVE'\s+using\s+errcode\s*=\s*'55000'/i);
  });

  it('상태가 바뀔 때만 거부한다 — 이름·위치 수정과 재활성화는 막지 않는다', () => {
    const fn = definitions.get('apply_machine_update')!;

    // 가드가 v_state_changed 를 함께 보지 않으면 비활성 설비는 어떤 수정도 못 하게 된다.
    expect(fn.body).toMatch(/if\s+v_state_changed\s+and\s+not\s+v_new_active/i);
    // v_new_active 는 "이 호출이 끝난 뒤의 값"이어야 한다. v_machine.is_active 를 그대로 보면
    // 재활성화와 상태 변경을 한 번에 하는 관리자 호출이 거부된다.
    expect(fn.body).toMatch(
      /p_updates \? 'is_active'[\s\S]{0,160}v_new_active\s*:=[\s\S]{0,160}v_machine\.is_active/i
    );
  });
});
