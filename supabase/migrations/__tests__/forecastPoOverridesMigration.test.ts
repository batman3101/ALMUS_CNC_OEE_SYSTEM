import fs from 'fs';
import path from 'path';

/**
 * 20260929130000_forecast_po_overrides 정적 검사.
 *
 * 로컬에서 DB 를 띄워 실행하는 검증이 아니다(이 저장소는 psql 격리 테스트를 별도로 둔다). 여기서는 이 마이그레이션이
 * **반드시 지켜야 하는 규약**이 파일에 남아 있는지만 본다 — 규약은 빠져도 SQL 은 멀쩡히 실행되기 때문이다:
 *   · 서비스 롤 전용(RLS 켬 + 정책 없음 + PUBLIC/anon/authenticated 회수 + service_role 복원)
 *   · 이력은 추가 전용
 *   · 수정값은 '접수 1건'에 속하고, 접수가 바뀌면 쓰기가 거부된다(초기화 = 사용자 결정 2026-09-29)
 */
const FILE = path.resolve(__dirname, '..', '20260929130000_forecast_po_overrides.sql');
const sql = fs.readFileSync(FILE, 'utf8').replace(/--.*$/gm, '');

const fn = (name: string) => {
  const start = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, 'i'));
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$$;', sql.indexOf('$$', sql.indexOf('as $$', start)) + 2);
  return sql.slice(start, end);
};

describe('forecast_po_overrides 마이그레이션', () => {
  it('두 표 모두 RLS 를 켜고 정책은 만들지 않는다(서비스 롤 라우트 전용)', () => {
    for (const table of ['forecast_po_overrides', 'forecast_po_override_events']) {
      expect(sql).toMatch(new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
    }
    expect(sql).not.toMatch(/create\s+policy/i);
  });

  it('PUBLIC/anon/authenticated 권한을 전수 회수하고 service_role 에 되돌려 준다', () => {
    expect(sql).toMatch(/revoke\s+all\s+on\s+public\.forecast_po_overrides,\s*public\.forecast_po_override_events\s+from\s+public,\s*anon,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+all\s+on\s+public\.forecast_po_overrides,\s*public\.forecast_po_override_events\s+to\s+service_role/i);
  });

  it('쓰기 함수는 security definer + 고정 search_path 이고, 실행 권한은 service_role 에만 있다', () => {
    for (const [name, args] of [
      ['apply_forecast_po_override', 'uuid, uuid, uuid, integer, date, text, integer, numeric, text'],
      ['revert_forecast_po_override', 'uuid, uuid, uuid, integer, date'],
    ]) {
      const body = fn(name);
      expect(body).toMatch(/security\s+definer/i);
      expect(body).toMatch(/set\s+search_path\s*=\s*public,\s*pg_temp/i);
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\(${args}\\)\\s+from\\s+public,\\s*anon,\\s*authenticated`, 'i'));
      expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${args}\\)\\s+to\\s+service_role`, 'i'));
    }
  });

  it('쓰기 전에 접수가 그대로인지 FOR SHARE 로 확인하고, 바뀌었으면 SUBMISSION_CHANGED(55000)로 거부한다', () => {
    for (const name of ['apply_forecast_po_override', 'revert_forecast_po_override']) {
      const body = fn(name);
      expect(body).toMatch(/from\s+public\.forecast_submissions[\s\S]*?submission_id\s*=\s*p_submission_id[\s\S]*?for\s+share/i);
      expect(body).toMatch(/raise\s+exception\s+'SUBMISSION_CHANGED'\s+using\s+errcode\s*=\s*'55000'/i);
      // 모든 문장이 공장 범위 안에 있다.
      for (const statement of body.match(/(?:from|update|into|delete\s+from)\s+public\.forecast_po_overrides\b[\s\S]*?;/gi) ?? []) {
        expect(statement).toMatch(/factory_id\s*=\s*p_factory_id|\(factory_id,/i);
      }
    }
  });

  it('적용은 표 갱신과 이력 추가를 함께 하고, 같은 값 재적용은 아무것도 쓰지 않는다', () => {
    const body = fn('apply_forecast_po_override');
    expect(body).toMatch(/insert\s+into\s+public\.forecast_po_overrides\b/i);
    expect(body).toMatch(/insert\s+into\s+public\.forecast_po_override_events\b/i);
    expect(body).toMatch(/v_before\s+is\s+not\s+null\s+and\s+v_before\s*=\s*p_quantity[\s\S]*?return/i);
    expect(body).toMatch(/INVALID_PO_QUANTITY/);
  });

  it('원복은 행을 지우되 이력을 남긴다', () => {
    const body = fn('revert_forecast_po_override');
    expect(body).toMatch(/delete\s+from\s+public\.forecast_po_overrides\b/i);
    expect(body).toMatch(/insert\s+into\s+public\.forecast_po_override_events\b[\s\S]*?'revert'/i);
  });

  it('이력 표는 추가 전용이다 — UPDATE 와 DELETE 를 모두 막는다', () => {
    expect(sql).toMatch(/create\s+trigger\s+trg_forecast_po_override_events_append_only\s+before\s+update\s+or\s+delete\s+on\s+public\.forecast_po_override_events/i);
    expect(fn('forbid_forecast_po_event_change')).toMatch(/raise\s+exception[\s\S]*errcode\s*=\s*'55000'/i);
  });

  it('접수를 확정(UPDATE)할 때마다 DB 가 submission_id 를 새로 만든다 — 앱 코드에 맡기지 않는다', () => {
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+submission_id\s+uuid\s+not\s+null\s+default\s+gen_random_uuid\(\)/i);
    expect(sql).toMatch(/create\s+trigger\s+trg_forecast_submissions_renew_id\s+before\s+update\s+on\s+public\.forecast_submissions\s+for\s+each\s+row/i);
    expect(fn('renew_forecast_submission_id')).toMatch(/new\.submission_id\s*:=\s*gen_random_uuid\(\)/i);
  });

  it('수정값은 접수 번호에 묶이되 접수 행에 FK 를 걸지 않는다(걸면 접수 교체가 막히거나 수정값이 따라간다)', () => {
    expect(sql).toMatch(/primary\s+key\s*\(factory_id,\s*submission_id,\s*source_row,\s*work_date\)/i);
    expect(sql).not.toMatch(/references\s+public\.forecast_submissions/i);
  });

  it('수량은 0 이상 1억 이하 정수이고, 원본 값의 상태는 파서가 내는 다섯 가지뿐이다', () => {
    expect(sql).toMatch(/quantity\s+integer\s+not\s+null\s+check\s*\(quantity\s+between\s+0\s+and\s+100000000\)/i);
    expect(sql).toMatch(/forecast_state\s+in\s*\('number',\s*'blank',\s*'error',\s*'missing_cache',\s*'invalid'\)/i);
  });
});
