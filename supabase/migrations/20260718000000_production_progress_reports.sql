-- 교대 중 진행 보고 (append-only).
--
-- 진행 중 데이터와 확정 데이터(production_records)를 물리적으로 분리한다. 그래야 진행 중
-- 교대(2시간, 60%)가 완료 교대(12시간, 96%)와 같이 평균나는 사고가 일어날 수 없다.
-- 그 버그는 2026-07-17 에 실제로 고쳤다(PR #18). production_records 는 손대지 않으므로
-- 기존 분석 RPC 는 한 줄도 바뀌지 않는다.
--
-- shift_output_qty 의 의미는 하나다: "이 교대에서 지금까지 만든 총 개수".
-- 작업자가 그 숫자를 어떻게 얻는지(리셋되는 카운터 판독/뺄셈/수기 집계)는 규정하지 않는다 —
-- 메커니즘으로 정의하면 카운터가 리셋되지 않는 설비에서 계약이 무너진다.

CREATE TABLE IF NOT EXISTS public.production_progress_reports (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id        uuid        NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  date              date        NOT NULL,
  shift             text        NOT NULL CHECK (shift IN ('A', 'B')),
  reported_at       timestamptz NOT NULL DEFAULT now(),
  shift_output_qty  integer     NOT NULL CHECK (shift_output_qty >= 0),
  operator_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.production_progress_reports IS
  '교대 중 진행 보고 (append-only). 확정 실적은 production_records 에 따로 있다.';
COMMENT ON COLUMN public.production_progress_reports.shift_output_qty IS
  '이 교대에서 지금까지 만든 총 개수 (누적). 파악 방법은 규정하지 않는다.';
COMMENT ON COLUMN public.production_progress_reports.date IS
  '교대 귀속일. B 교대는 시작일 (자정을 넘겨도 시작일로 귀속).';
COMMENT ON COLUMN public.production_progress_reports.operator_id IS
  '보고한 작업자. 계정이 지워져도 보고 자체는 사실이므로 SET NULL 로 남긴다.';

-- 조회는 항상 "이 설비, 이 날짜, 이 교대의 최신 보고" 를 찾는다.
CREATE INDEX IF NOT EXISTS idx_progress_reports_machine_shift
  ON public.production_progress_reports (machine_id, date, shift, reported_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 접근 제어: service_role 전용 (production_shift_states / alert_acknowledgements 와 같은 형태).
-- ─────────────────────────────────────────────────────────────────────────────

-- 자물쇠 1: 정책을 하나도 만들지 않은 채 RLS 를 켠다.
-- 정책 없는 RLS = BYPASSRLS 가 아닌 역할(anon/authenticated) 전면 차단.
-- 아래 REVOKE 와 독립적이다 — GRANT 가 실수로 되살아나도 이 자물쇠가 남는다.
ALTER TABLE public.production_progress_reports ENABLE ROW LEVEL SECURITY;

-- 자물쇠 2: 테이블 권한. REVOKE 가 service_role 까지 포함하는 이유는 이 파일에 보이지 않는다 —
--   public 스키마의 default ACL(pg_default_acl, objtype='r')이 새로 만들어지는 모든 테이블에
--   anon / authenticated / service_role 에게 arwdDxtm(전 권한)을 자동으로 준다. 즉 CREATE TABLE
--   직후 이 테이블은 이미 세 역할 모두에게 UPDATE/DELETE 까지 열려 있다.
--   GRANT 는 더하기만 한다 — 좁히지 못한다. 먼저 REVOKE 로 지워야 한다.
--   실측 증거(라이브 DB): system_settings_audit 은 마이그레이션에서 service_role 에게 INSERT 만
--   GRANT 했으나 실제 권한은 arwdDxtm 전부이고, production_shift_states 도 4개만 GRANT 했으나
--   실제는 전부다. 둘 다 REVOKE 목록에서 service_role 을 빠뜨렸기 때문이다.
--   ⚠️ 이 목록에서 service_role 을 빼면 UPDATE/DELETE 가 조용히 살아난다.
REVOKE ALL ON TABLE public.production_progress_reports
  FROM PUBLIC, anon, authenticated, service_role;

-- append-only 는 여기서 만들어진다: UPDATE/DELETE 를 아무에게도 주지 않는다.
-- service_role 은 BYPASSRLS 라 **정책은 우회하지만 테이블 권한은 우회하지 못한다.**
-- 이 저장소의 모든 접근은 API 라우트의 supabaseAdmin(service_role)을 거치므로,
-- service_role 에게 UPDATE/DELETE 가 없다는 사실이 실제로 존재하는 유일한 경로에서
-- append-only 를 참으로 만든다. anon/authenticated 에게는 grant 도 정책도 없다.
GRANT SELECT, INSERT ON TABLE public.production_progress_reports TO service_role;

-- 오타는 수정이 아니라 새 보고를 추가해 덮는다 — "13:00 에 150개였다"는 불변 사실이고,
-- 사실은 고쳐 쓰는 게 아니라 다음 사실로 갱신한다. 스냅샷을 나중에 덮어쓰면 과거가 조용히 바뀐다.
--
-- 범위 한정: machines 행이 지워지면 ON DELETE CASCADE 가 이 테이블의 행을 지우고, auth.users
-- 행이 지워지면 ON DELETE SET NULL 이 operator_id 를 고친다. 참조 무결성 동작은 RI 트리거가
-- 참조하는 테이블 소유자 권한으로 수행하므로 service_role 의 권한 부재와 무관하게 실행된다.
-- 즉 append-only 는 "애플리케이션 경로에서 UPDATE/DELETE 가 불가능하다"는 뜻이지, 행이 영원히
-- 불변이라는 뜻이 아니다.
--
-- ⚠️ 진짜 인가는 여전히 API 계층에 있다. 위의 GRANT/RLS 는 담당 설비도, 값의 단조 증가도,
--    작성자도 검사하지 않는다 — service_role 로 들어오면 전부 통과한다:
--      - 인증/역할: requireUser (src/lib/apiAuth.ts)
--      - 담당 설비: assertMachineAccess
--      - 작성자 위조 방지: operator_id 를 요청 본문이 아니라 인증된 세션(user.userId)에서 취함
--      - 감소 감지: 직전 보고보다 작은 값은 409 (Task 4)
--    이 파일을 읽고 "DB 가 막아준다"고 결론내려 API 계층의 검사를 지우면 안 된다.
