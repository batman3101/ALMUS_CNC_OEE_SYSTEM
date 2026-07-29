# Codex 감사(2026-07-29) 검증 결과 및 수정 방안

- **기준 커밋**: `b6b6c0bec6fcbf9940bc88f7a29b20fe0e80065b` (`HEAD == origin/main`, 워킹트리 clean)
- **검증자**: Claude (독립 재검증)
- **검증 방법**: 소스 직접 확인 + 운영 DB 조회(정책·grant·설정·RPC 최종 정의) + 배포된 Edge Function 원문 대조
- **결론**: 9건 중 **9건 모두 실재**. 다만 3건은 심각도·범위를 정정해야 하고, 1건은 코덱스가 "확인 불가"로 남긴 부분을 이번에 확정했다. **추가로 1건을 새로 발견**했다.

> 이 문서는 감사 결과와 수정 방안이다. 아래 "수정 적용 현황"이 무엇을 고쳤고 무엇을
> 남겼는지 말한다.

---

## 수정 적용 현황 — **운영 반영 완료 (2026-07-29)**

PR [#29](https://github.com/batman3101/ALMUS_CNC_OEE_SYSTEM/pull/29) (코드) →
PR [#30](https://github.com/batman3101/ALMUS_CNC_OEE_SYSTEM/pull/30) (RLS 성능 수정 + 원장).
마이그레이션 4건 운영 적용 완료, 브라우저 검증 통과.

| # | 항목 | 코드 | DB/배포 | 회귀 테스트 |
|---|---|---|---|---|
| 1 | 자격증명 노출 | ✅ 주석 삭제 + `scripts/` 3개 파일 env 화 | 🔑 **비밀번호 회전은 사용자 몫** | `noHardcodedCredentials.test.ts` |
| 2 | 비밀번호 로깅 | ✅ `redactSecrets()` 도입, 본문 로깅 4곳 적용 | — | `redactSecrets.test.ts` |
| 3 | RLS 우회 | — | ✅ `20260729130000` · `20260729140000` 적용 | `rlsPolicyLedger.test.ts` |
| 4 | Edge Fn 인가 | ✅ 소스 수정 | ⏸ **배포 안 함** (아래) | `dailyOeeAggregationAuthz.test.ts` |
| 5 | 임의 교대 진척 | ✅ 라우트 시간창 가드 | ✅ `20260729120000` 적용 | `shiftReportingWindow.test.ts` + 라우트 6건 |
| 6 | 마감 비원자 | ⏭ **미착수** (아래 사유) | — | — |
| 7 | 설정 실패 위장 | ✅ fail-loud + 중복 사본 2개 제거 | — | `settingsFailLoud.test.ts` |
| 8 | Realtime 유실 | ✅ 이벤트 버퍼 + 스냅샷 후 재생 | — | `realtimeBuffer.test.ts` |
| 9 | 종료시각 무시 | ✅ UI 파생 표시로 전환 (ko/vi) | — | (브라우저 확인) |
| 10 | anon grant | — | ✅ `20260729150000` 적용 | — |

### 적용 중 발견해 고친 것 — 초안 RLS 술어가 166배 느렸다

`20260729140000` 초안은 `machine_id::text = any (current_user_machines())` 였다.
적용 전 EXPLAIN 검증에서 못 쓸 물건임이 드러났다(operator, 최근 7일 9,139행 반환):

| 술어 | 실행시간 | buffers |
|---|---|---|
| 정책 없음(기준선) | 4.2 ms | 782 |
| `= any(fn())` — 초안 | **701.1 ms** | 73,894 |
| `(select fn()) @> array[...]` | 294.9 ms | 55,797 |
| `in (select unnest(fn()))` — 채택 | **12.9 ms** | 793 |

**STABLE 함수라고 한 번만 평가되지 않는다.** `= any(fn())` 은 함수를 행마다 부른다.
`(select …)` 로 감싸면 InitPlan 이 잡혀 호출은 1회가 되지만(Supabase 문서 권장) 여전히
느리다 — 800개짜리 `text[]` 가 TOAST 에 있어 `@>` 가 행마다 detoast 하기 때문이다.
`in (select unnest(...))` 만이 hashed SubPlan 으로 바뀌어 기준선 수준이 된다.

### 운영 검증 결과

- **130000** — 적용 전 탐침에서 운영자의 `machine_logs` 직접 INSERT 가 **성공**함을 확인한
  뒤 막았다. 적용 후: INSERT `42501` 거부, UPDATE/DELETE 0행, SELECT 유지, DEFINER 트리거는
  쓰기 권한 없이도 로그 기록.
- **140000** — operator 13.3ms(buffers 793), admin 6.5ms(SubPlan `never executed`).
  격리 검증: 담당 2대로 좁힌 운영자는 24,516행 중 **61행(설비 2대)** 만 본다.
- **브라우저(관리자)** — 설비 800/800, 리포트가 **24,430/24,516건** 읽음(누락 0),
  실시간 연결 정상, 운영자 콘솔 **계획 가동시간 610분**(=720−110, #7 이 실제 설정을
  읽고 있다는 증거), 교대 설정의 종료시각이 읽기 전용 파생 표시로 렌더.
  Vercel 런타임 오류 0건, 4xx·5xx 0건.

### 남은 것

**#4 Edge Function** — 소스는 고쳤으나 **배포하지 않았다.** 배포는 즉시 운영 동작을 바꾸고
pg_cron 정기 집계(08:30/20:30) 경로를 건드리므로 별도 승인 대상이다.

**#6 마감 원자성** — 발생 빈도가 가장 낮고(마감은 교대 종료 후에만 실행되므로 창이 사후
정정에만 열린다) 수정 비용이 가장 크다 — 새 RPC `close_shift_upsert_v2` 를 만들고 코드 배포
후 구 함수를 지우는 **2단계 배포**가 필요하다.

**비밀번호 회전** — 코드 쪽 삭제는 완료. 회전은 저장소 소유자만 가능하다.

**검증** — ESLint 0 error / 18 warning(기준선 동일), TypeScript 통과, Jest **103 suites
674 tests 통과**, 프로덕션 빌드 성공, `check:migrations` 적용 41 · 미적용 0 · 드리프트 0.

---

## 0. 요약표

| # | 항목 | 코덱스 등급 | 검증 | 조정 등급 | 근거 |
|---|---|---|---|---|---|
| 1 | 공개 저장소에 평문 계정정보 | HIGH | **확인** | **CRITICAL** | 저장소 `PUBLIC` 확정. 이미 노출된 자격증명 |
| 2 | 사용자 비밀번호 서버 로그 기록 | HIGH | **확인** | HIGH | `route.ts:59` 요청 본문 전체 출력 |
| 3 | RLS 가 API 의 역할·담당설비 제한을 우회 | HIGH | **확인** | HIGH | 운영 정책 실측 일치 |
| 4 | Edge Function 관리자 검사 없음 | HIGH | **확인** | **MEDIUM** | 배포본 원문 확인 완료. 영향 범위가 좁음 |
| 5 | 임의 과거·미래 교대에 진척 보고 | HIGH | **확인(범위 정정)** | HIGH | `production-progress` 만 해당. `close-shift` 는 이미 가드 있음 |
| 6 | 교대 마감 계산·저장 비원자 | HIGH | **확인** | **MEDIUM** | 마감은 교대 종료 후에만 실행되어 창이 좁음 |
| 7 | 설정 조회 실패가 정상 기본값처럼 저장 | HIGH | **확인** | HIGH | 운영 휴식 110분 vs 기본 60분 — 50분 오차 확정 |
| 8 | Realtime 초기 구독 이벤트 유실 창 | MEDIUM | **확인** | MEDIUM | 스냅샷이 배열을 통째로 교체 |
| 9 | 관리자 저장 교대 종료시각을 서버가 무시 | MEDIUM | **확인** | **LOW(잠재)** | 현재 설정에서 미발현 |
| **10** | **anon 역할에 핵심 테이블 전 DML grant 잔존** | *미보고* | **신규 발견** | MEDIUM | 심층방어 부재 |

---

## 1. CRITICAL — 공개 저장소에 평문 계정정보

**위치**: `src/components/auth/LoginFormInline.tsx:29-37`

```tsx
// 자동 로그인 비활성화 - 항상 수동으로 입력하도록 변경
// React.useEffect(() => {
//   if (isDevelopment()) {
//     form.setFieldsValue({
//       email: '<관리자 실제 이메일>',
//       password: '<평문 비밀번호>'      // ← 실제 값이 그대로 있었다
//     });
```

> 이 문서에는 실제 값을 옮겨 적지 않는다. 감사 문서가 유출 지점이 되면 안 된다.
> 원본은 아래 커밋에서 확인할 수 있다.

### 검증 결과

- `gh repo view` → `batman3101/ALMUS_CNC_OEE_SYSTEM`, **visibility: PUBLIC**. 확정.
- 코드가 주석 처리되어 **실행되지 않는다는 점은 무관하다**. 노출은 파일이 공개된 시점에 이미 발생했다.
- `git log -S <비밀번호>` → 최소 `acde36f`, `d3849cb` 두 커밋에 남아 있다. 현재 파일만 고쳐도 **히스토리에서 사라지지 않는다.**
- 이 이메일은 이 저장소의 커밋 작성자 계정이자 시스템 관리자 계정이다. 코덱스가 "유효성 미시험"으로 HIGH 에 둔 것은 타당한 신중함이지만, **노출된 자격증명은 유효성과 무관하게 회전 대상**이다.

→ 등급을 **CRITICAL** 로 올린다.

### 수정 방안

| 순서 | 조치 | 담당 | 비고 |
|---|---|---|---|
| **1 (즉시)** | 해당 계정 **비밀번호 변경** + 다른 서비스 재사용 여부 확인 | **사용자만 가능** | 코드 수정보다 먼저. 이것만이 실효 조치 |
| 2 | 주석 블록 삭제 | 코드 | `git rm` 아님, 해당 9줄 제거 |
| 3 | 재발 방지 회귀 테스트 | 코드 | 아래 |
| 4 | (선택) 히스토리 재작성 | 사용자 판단 | 아래 |

**3. 회귀 테스트 안** — `src/__tests__/noHardcodedCredentials.test.ts`:
`src/**` 과 `scripts/**` 을 훑어 `password`/`passwd`/`pwd` 뒤에 문자열 리터럴이 오는 패턴을 금지한다. 주석 안도 검사 대상에 포함한다 — 이번 건이 정확히 주석 안에서 났다.

**4. 히스토리 재작성에 대한 정직한 판단**
공개 저장소이므로 `git filter-repo` 로 히스토리를 지워도 이미 **클론·포크·GitHub 이벤트 캐시·검색 인덱스에 남은 사본은 회수할 수 없다.** 재작성은 모든 협업자의 로컬 히스토리를 깨뜨리는 파괴적 작업인데 얻는 것은 "새로 클론하는 사람에게는 안 보임" 뿐이다.
**권장: 비밀번호 회전으로 값을 무의미하게 만드는 것이 유일하게 확실한 조치다.** 히스토리 재작성은 하더라도 그 다음이며, 회전을 대체하지 않는다.

**개발용 자동 로그인이 다시 필요해지면**: 코드 리터럴이 아니라 `.env.local` 의 `NEXT_PUBLIC_DEV_LOGIN_EMAIL` / `NEXT_PUBLIC_DEV_LOGIN_PASSWORD` 로 받고, `.env.example` 에는 플레이스홀더만 둔다.

---

## 2. HIGH — 사용자 생성 비밀번호가 서버 로그에 기록됨

**위치**: `src/app/api/admin/users/route.ts:58-60`

```ts
const body = await request.json();
console.log('🔍 받은 요청 데이터:', JSON.stringify(body, null, 2));
const { email, password, name, role, assigned_machines } = body;
```

### 검증 결과

확정. `body` 에는 `password` 가 들어 있고, 이 값이 `JSON.stringify` 로 전부 출력된다. Vercel 함수 로그는 보존·검색 가능하므로 **관리자가 계정을 만들 때마다 평문 비밀번호가 로그에 영구 기록**된다. 조건부가 아니라 **확정 경로**다.

(같은 파일 92행 `profileInsertData` 로그에는 비밀번호가 없다 — 이쪽은 문제 없다.)

### 수정 방안

```ts
const body = await request.json();
const { email, password, name, role, assigned_machines } = body;
// 비밀번호는 절대 로깅하지 않는다. 진단에 필요한 것은 나머지 필드다.
console.log('사용자 생성 요청:', { email, name, role, assigned_machines });
```

**부수 작업(필수)**: `console.log(...)` 에 요청 본문을 통째로 넣는 다른 라우트가 있는지 전수 조사한다.
`grep -rn "JSON.stringify(body" src/app/api/` 및 `console.log.*body` 로 확인한 뒤 같은 규율을 적용한다.

**회귀 테스트 안**: `route.ts` POST 를 호출하면서 `console.log` 를 spy 하고, 출력 문자열 어디에도 전달한 비밀번호가 없음을 단언한다. (이 테스트는 관측 가능한 인과가 명확하다 — 로그 문자열이 곧 결과물이므로 위장 테스트가 되지 않는다.)

---

## 3. HIGH — RLS 가 API 의 역할·담당설비 제한을 우회

**위치**: `supabase/migrations/20260715200000_restrict_anon_access_core_tables.sql`

### 검증 결과 — 운영 DB 실측

```
machine_logs        | Authenticated can access machine_logs      | ALL    | using=true, check=true
machines            | Authenticated can read machines            | SELECT | using=true
production_records  | Authenticated can read production_records  | SELECT | using=true
```

코덱스의 서술과 운영 상태가 정확히 일치한다. 결과:

- **읽기**: 어떤 역할이든 로그인만 하면 `NEXT_PUBLIC_SUPABASE_ANON_KEY` + 자기 JWT 로 PostgREST 를 직접 호출해 **전 설비의 생산실적·설비 정보를 조회**할 수 있다. `assertMachineAccess`(`src/lib/apiAuth.ts:91`)는 API 라우트 안에서만 동작하므로 이 경로를 막지 못한다.
- **쓰기**: `machine_logs` 는 `FOR ALL`, `WITH CHECK (true)` 다. 즉 **임의 운영자가 임의 설비의 상태 이력을 INSERT/UPDATE/DELETE 할 수 있다.** `machine_logs` 는 비가동 계산의 두 원천 중 하나이므로(`src/lib/shiftDowntime.ts`), 이는 곧 **OEE 조작 경로**다.

`useRealtimeData.ts:365-377` 의 주석이 이 사실을 이미 인지하고 있다:
> *(RLS 가 authenticated 전체 조회를 아직 허용하므로 이 클라이언트 스코프가 방어선이다)*

클라이언트 스코프는 전송량과 DevTools 노출을 줄이지만, **보안 경계가 아니다.**

### 왜 이렇게 되어 있는가 (마이그레이션 주석의 설계 근거)

> *machine_logs: SECURITY INVOKER 트리거 `log_machine_status_change` 가 쓰므로, authenticated 쓰기를 없애면 상태 변경이 깨진다.*

운영 DB 에서 확인: `log_machine_status_change` 의 `prosecdef = false` — **실제로 INVOKER 가 맞다.** 근거 자체는 사실이다. 다만 그 제약은 **트리거 함수를 SECURITY DEFINER 로 바꾸면 사라진다.**

### 수정 방안 — 3단계, 각각 독립 마이그레이션

**설계 원칙**: 한 번에 다 조이면 어디서 깨졌는지 알 수 없다. 단계마다 되돌릴 수 있게 나눈다.

#### 3-A. `machine_logs` 쓰기 차단 (가장 위험한 구멍부터)

```sql
-- 트리거를 DEFINER 로 승격. search_path 고정은 DEFINER 함수의 필수 규율이다.
create or replace function public.log_machine_status_change() ...
  security definer
  set search_path = public, pg_temp;

-- 쓰기 정책 철회, 읽기만 남긴다.
drop policy "Authenticated can access machine_logs" on public.machine_logs;
create policy "Authenticated can read machine_logs"
  on public.machine_logs for select to authenticated using (true);
```

**사전 확인 필요**: `machines` 를 클라이언트가 직접 UPDATE 하는 경로가 남아 있는지. 운영 DB 에 `"Authenticated users can modify machines"`(admin/engineer, ALL) 정책이 살아 있으므로 그 경로가 존재할 수 있다. DEFINER 승격은 그 경로도 계속 동작시키므로 안전하지만, **트리거가 `app.status_operator_id` 같은 세션 설정에 의존한다면 DEFINER 전환 시 동작을 재확인**해야 한다.

#### 3-B. 읽기 스코프화 (operator 는 담당 설비만)

```sql
-- 역할·담당설비를 행마다 서브쿼리로 조회하면 32만 행에서 계획이 무너진다.
-- STABLE SECURITY DEFINER 헬퍼로 한 번만 평가되게 한다.
create function public.current_user_role() returns text
  language sql stable security definer set search_path = public, pg_temp
as $$ select role from public.user_profiles where user_id = (select auth.uid()) $$;

create function public.current_user_machines() returns text[]
  language sql stable security definer set search_path = public, pg_temp
as $$ select assigned_machines from public.user_profiles where user_id = (select auth.uid()) $$;

create policy "Scoped read production_records" on public.production_records
  for select to authenticated using (
    public.current_user_role() in ('admin','engineer')
    or machine_id::text = any(public.current_user_machines())
  );
```

**⚠ 성능 검증이 이 단계의 핵심 리스크다.** `production_records` 는 ~32.5만 행이다. RLS 술어는 모든 행에 붙으므로 실행계획이 바뀐다. 적용 전에 대표 쿼리 3종(일별 집계, 기간 조회, 대시보드 최근 실적)의 `EXPLAIN ANALYZE` 를 전후 비교하고, `machine_id` 인덱스 활용이 유지되는지 확인한다.

> 참고: `analytics_*` RPC 들은 service_role 로 실행되어 RLS 를 우회하므로 이 변경의 영향을 받지 않는다. 영향권은 **클라이언트 직접 쿼리 경로**(`useRealtimeData` 등)뿐이다. 이 점이 3-B 의 위험을 크게 낮춘다.

#### 3-C. 회귀 테스트

기존 `supabase/migrations/__tests__/machineStateLockProtocol.test.ts` 가 "마이그레이션 전체를 훑어 각 함수의 **최종 정의**를 모아 규약을 강제"하는 방식을 쓴다. 같은 방식으로 **RLS 정책 원장 테스트**를 추가한다: 핵심 테이블의 최종 정책이 `using(true)` 를 쓰지 않는지, `FOR ALL TO authenticated` 가 없는지 검사한다. 새 마이그레이션이 규약을 깨면 자동으로 걸린다.

---

## 4. MEDIUM (등급 하향) — Service Role Edge Function 에 관리자 검사 없음

**위치**: `supabase/functions/daily-oee-aggregation/index.ts:95`

### 검증 결과 — 코덱스가 남긴 공백을 메움

코덱스는 *"배포본과 로컬 소스의 바이트 단위 동일성은 확인하지 못했다"* 고 했다.
**`get_edge_function` 으로 배포본 원문을 받아 대조했다.** 결과:

- 주석 분량만 다르고 **실행 코드는 로컬과 동일**하다. 호출자 역할 검사는 **배포본에도 없다.**
- `verify_jwt: true`, `status: ACTIVE`, `version: 1`.

→ **유효한 JWT 를 가진 아무 로그인 사용자(운영자 포함)나 호출할 수 있다.** 코덱스의 조건부 서술("현재 main 소스가 배포되어 있다면")은 **확정**으로 바뀐다.

### 다만 영향 범위는 코덱스 서술보다 좁다

코덱스는 *"임의 날짜의 생산실적을 갱신"* 이라고 썼다. 실제 코드가 하는 일은 그보다 훨씬 좁다:

```ts
if ((row.output_qty ?? 0) > 0) return false;   // 생산이 있으면 손대지 않음
... update({ ideal_runtime: 0, performance: 0, quality: 0, oee: 0 })
```

- **INSERT 없음**, 그리고 `output_qty > 0` 인 행은 **한 줄도 건드리지 않는다.**
- 쓰는 값은 `output_qty = 0` 일 때 산술적으로 반드시 참인 값이다.
- 즉 공격자가 얻는 것은 "이미 정합성이 깨진 행을 정합하게 만드는 것"뿐이다.

→ **인가 부재는 실재하는 결함이지만 데이터 손상 능력이 없다.** HIGH → **MEDIUM** 으로 조정한다. 수정은 여전히 필요하다 — 함수 본문이 나중에 확장되면 그때는 실제 권한 상승이 된다.

### 수정 방안

```ts
// service_role 키로 호출하는 pg_cron 경로와, 사람이 관리 UI 에서 호출하는 경로를 함께 허용한다.
const authHeader = req.headers.get('Authorization') ?? '';
const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
const claims = decodeJwtPayload(token);            // 검증은 이미 verify_jwt 가 했다

if (claims?.role !== 'service_role') {
  const { data: caller } = await supabase.auth.getUser(token);
  if (!caller?.user) return json({ error: 'unauthorized' }, 401);
  const { data: profile } = await supabase
    .from('user_profiles').select('role, is_active')
    .eq('user_id', caller.user.id).maybeSingle();
  if (profile?.role !== 'admin' || profile.is_active !== true) {
    return json({ error: 'forbidden' }, 403);
  }
}
```

**`service_role` 분기가 필수인 이유**: pg_cron 스케줄(08:30 / 20:30)은 service_role 키로 호출한다. 그 토큰에는 대응하는 `user_profiles` 행이 없으므로, 분기 없이 프로필 조회만 하면 **정기 집계가 통째로 죽는다.**

**테스트**: Deno 함수는 Jest 커버리지 밖이다. 인가 판단을 순수 함수 `isAuthorizedCaller(claims, profile)` 로 분리해 Jest 로 검증하고, Edge Function 은 그 함수를 호출만 한다.

---

## 5. HIGH — 임의 과거·미래 교대에 진척 보고 가능 (범위 정정)

### 검증 결과

**코덱스가 두 경로를 하나로 묶었는데, 실제로는 하나만 해당한다.**

| 경로 | 시간창 가드 | 판정 |
|---|---|---|
| `POST /api/production-progress` (`route.ts:28`) | **없음** | ❌ 확인 |
| `POST /api/production-records/close-shift` (`route.ts:52`) | **있음** — `if (window.end > Date.now()) return 400 '이른 마감 금지'` | ✅ 미해당 |

`close-shift` 는 이미 미래·진행중 교대를 차단한다(자체 감사 #4 로 이미 수정됨). **과거 교대 마감은 "늦은 마감 무기한 허용"으로 의도된 정책**이다 — 결함이 아니다.

`report_shift_progress` 의 **운영 DB 최종 정의**를 조회해 확인한 결과(후속 마이그레이션 `20260720030000` 이 다른 세 함수는 고쳤지만 이 함수는 손대지 않았다):

- `p_date` / `p_shift` 를 **서버 시각과 대조하지 않는다**
- **`machines.is_active` 를 확인하지 않는다** — `toggle_machine_downtime` 은 `20260720030000` 에서 `machine_inactive` 가드를 받았는데 이 함수는 빠졌다

→ 담당 설비를 가진 운영자가 API 를 직접 호출하면 **임의 과거·미래 교대에 진척 보고를 삽입**할 수 있고, 그 값은 `close-shift` 가 `output_qty` 로 승격시킨다. 그리고 **비활성 설비에도 보고가 남는다.**

### 수정 방안 — 두 가드를 서로 다른 층에 둔다

> **CLAUDE.md 규약**: *"판단과 쓰기는 같은 잠금 아래 있어야 한다."* 다만 그 규약의 취지는 **경쟁하는 상대가 있는 판단**을 위한 것이다. 두 가드는 성격이 다르므로 다른 층에 둔다.

**(a) 시간창 가드 → 라우트 층 (경쟁 상대 없음)**

판단 재료가 **서버 시각과 교대 설정**이다. 서버 시각은 아무도 바꾸지 않고, 교대 설정 변경은 관리자 UI 를 통한 극히 드문 사건이다. TOCTOU 위험이 실질적으로 없으므로 라우트에서 검사해도 규약 위반이 아니다.

```ts
const window = await getShiftWindow(date, shift);
if (!window) return 500;
const now = Date.now();
// 교대 종료 후 유예: 이미 있는 shift_change_buffer_minutes(운영값 10분) 설정을 쓴다.
const graceMs = (await getShiftChangeBufferMinutes()) * 60_000;
if (now < window.start || now >= window.end + graceMs) {
  return NextResponse.json({ error: 'shift is not open for progress reporting' }, { status: 400 });
}
```

**유예 시간이 필요한 이유**: 유예 없이 `window.end` 에서 딱 끊으면, 교대 종료 직전 마지막 보고를 하려던 작업자가 몇 초 늦었다는 이유로 거부당한다. 운영을 방해하는 가드는 우회된다. `shift_change_buffer_minutes` 설정이 이미 존재하고 운영값이 10분이므로 그것을 쓴다.

**(b) 비활성 설비 가드 → RPC 안, 락 아래 (경쟁 상대 있음)**

관리자의 설비 비활성화와 **정면으로 경쟁한다**. Node 에서 먼저 조회하면 조회와 쓰기 사이가 비어 있다. `toggle_machine_downtime` 과 동일한 형태로 RPC 본문에 넣는다:

```sql
-- report_shift_progress 안, advisory lock 확보 직후
select is_active into v_active from public.machines where id = p_machine_id for update;
if v_active is null then
  return jsonb_build_object('ok', false, 'reason', 'machine_not_found');
end if;
if not v_active then
  return jsonb_build_object('ok', false, 'reason', 'machine_inactive');
end if;
```

**⚠ 시그니처를 바꾸지 않는다.** CLAUDE.md 의 경고대로 인자를 늘리면 `create or replace` 가 오버로드를 만들고, `DROP` 하면 마이그레이션↔코드 배포 사이에 "함수 없음" 창이 생긴다. 이 가드는 **인자가 필요 없다** — 본문만 바꾸는 `create or replace` 로 끝나며, 마이그레이션이 코드보다 먼저 적용돼도 안전하다.

**⚠ `for update` 를 붙이는 이유**: `20260729060000_machine_row_lock_on_read.sql` 이 세운 규약 — 상태를 판단하는 RPC 는 `machines` 를 **행 잠금과 함께** 읽어야 한다. advisory lock 만으로는 RPC 를 거치지 않는 직접 UPDATE 경로(관리자 설비 비활성화)와 상호 배제되지 않는다.

**회귀 테스트**: `machineStateLockProtocol.test.ts` 가 이미 최종 정의를 훑는다. `report_shift_progress` 가 `machines` 를 읽기 시작하면 그 테스트의 검사 대상에 자동으로 들어오는지 확인하고, 아니라면 검사 범위를 넓힌다.

---

## 6. MEDIUM (등급 하향) — 교대 마감 OEE 계산과 저장이 비원자적

**위치**: `src/app/api/production-records/close-shift/route.ts:47-82`

### 검증 결과

구조는 코덱스 서술 그대로다. 라우트가 트랜잭션 **밖에서** 비가동·휴식설정·tact 를 읽어 `computeShiftSnapshot` 으로 계산하고, 결과 숫자를 `close_shift_upsert` 에 넘긴다. RPC 는 composite advisory lock 을 잡지만 **원천 데이터를 다시 확인하지 않는다** — 넘어온 숫자를 그대로 저장한다.

### 다만 창이 코덱스 서술보다 좁다

라우트 52행이 `window.end > Date.now()` 를 강제하므로 **마감은 교대가 끝난 뒤에만 실행된다.** 따라서:

- 진행 중인 비가동이 계산 도중 변하는 시나리오는 **발생하지 않는다**
- 남는 창은 **비가동 사후 정정**(andon 재개 지연 입력, 비가동 항목 수정)이 마감과 겹치는 경우뿐이다

드물지만 실재한다. 그리고 발생하면 **원천과 다른 확정 OEE 가 영구 저장**되고, 스냅샷 보존 원칙 때문에 나중에 원천을 고쳐도 저장된 값은 따라오지 않는다. → **MEDIUM**.

### 수정 방안 — 낙관적 동시성(지문 대조)

비가동 계산 로직(계획정지·휴식 겹침 클립·구간 유니온)을 SQL 로 재구현해 RPC 안으로 옮기는 것은 **하지 않는다.** 같은 규칙이 두 언어로 두 벌 존재하게 되고, 한쪽만 고쳐지는 순간 실시간과 확정이 다른 말을 하게 된다 — 이 저장소가 `loadDowntimeSourceRows` 를 단일 소스로 만들며 이미 한 번 겪은 실패다.

대신 **읽은 원천의 지문을 넘겨 락 아래에서 재대조**한다:

```
라우트: 비가동 원천 행을 읽을 때 지문도 계산
        fingerprint = md5(정렬된 (id, start_time, end_time) 목록)
RPC:    락 확보 후 같은 지문을 재계산 → 다르면 { ok:false, reason:'source_changed' }
라우트: 409 응답 → 클라이언트가 자동 1회 재시도
```

**⚠ 시그니처가 바뀐다** — 인자 하나가 는다. CLAUDE.md 경고 그대로 `create or replace` 는 오버로드를 만들고 `DROP` 은 배포 창을 만든다.
→ **새 이름 `close_shift_upsert_v2` 로 만들고 구 함수는 남긴다.** 코드 배포 후 구 함수를 별도 마이그레이션으로 제거하면 순서 의존이 사라진다.

**우선순위**: #1~#3, #5, #7 을 먼저 처리한다. 이 항목은 발생 빈도가 낮고 수정 비용이 크다.

---

## 7. HIGH — 설정 조회 실패가 정상 기본값처럼 저장됨

**위치**: `src/lib/plannedRuntime.ts:35-47`, `src/lib/shiftConfig.ts:32,43-45`

```ts
if (error || !data) {
  return DEFAULT_BREAK_TIME_MINUTES;   // 60
}
```

### 검증 결과 — 운영 설정값으로 오차 확정

운영 DB 실측:

| 설정 | 운영값 | 코드 기본값 | 차이 |
|---|---|---|---|
| `break_time_minutes` | **110** | 60 | **50분** |
| `shift_a_start` | 08:00 | 08:00 | 0 |
| `shift_b_start` | 20:00 | 20:00 | 0 |
| `timezone` | Asia/Ho_Chi_Minh | 동일 | 0 |

`planned_runtime = max(0, operating - break)` 이므로 **조회가 실패하기만 하면** `720 - 60 = 660` 분으로 계산된다. 정상값은 `720 - 110 = 610` 분이다.

`availability = actual / planned` 이므로 분모가 8.2% 커지고, **그 값이 `close_shift_upsert` 를 통해 스냅샷으로 영구 저장**된다. 나중에 설정 조회가 정상으로 돌아와도 저장된 행은 바뀌지 않는다.

**핵심**: 코드가 `error` 와 `!data` 를 **같은 분기로 처리한다.** 이것은 CLAUDE.md 가 이미 명문화한 실수와 같은 종류다:

> *"조회했더니 0" 과 "조회를 못 했다" 는 서로 다른 종류의 모름이다. 후자에 0 을 단언하면 데이터를 날조하는 것이다.*

여기서는 "설정이 없다"(→ 기본값 타당)와 "설정을 못 읽었다"(→ 아무것도 단언할 수 없음)를 뭉갰다.

### 수정 방안

```ts
export async function getBreakTimeMinutes(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('system_settings').select('setting_value')
    .eq('category','shift').eq('setting_key','break_time_minutes')
    .eq('is_active', true).maybeSingle();

  // 조회 실패 = 알 수 없음. 기본값으로 위장하지 않는다.
  if (error) throw new Error(`break_time_minutes 조회 실패: ${error.message}`);

  // 행 부재 = "설정한 적 없음" — 이것만 기본값이 정당하다.
  if (!data) return DEFAULT_BREAK_TIME_MINUTES;

  const raw = (data.setting_value as { value?: unknown } | null)?.value;
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  // 값이 있는데 파싱 불가 = 설정이 깨졌다. 조용히 기본값으로 덮지 않는다.
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`break_time_minutes 설정값이 유효하지 않습니다: ${JSON.stringify(raw)}`);
  }
  return parsed;
}
```

`getBusinessTimeConfig` 도 동일하게: `error` → throw, 행 부재 → 기본값, `catch {}` 로 예외를 삼키는 부분 제거.

**영향 검토(호출자 전수 필요)**

| 호출자 | throw 시 결과 | 판단 |
|---|---|---|
| `close-shift` (쓰기) | 500 → 저장 안 됨 | ✅ 원하는 동작. 틀린 값 저장보다 낫다 |
| `production-progress` GET (읽기) | 이미 try/catch → 500 | ✅ 허용. 화면이 "계산 불가"를 보여준다 |
| `production-records/daily` (읽기) | 확인 필요 | ⚠ 전수 조사 대상 |
| 리포트·분석 라우트 | 확인 필요 | ⚠ 전수 조사 대상 |

**읽기 경로까지 전부 500 이 되는 것이 과한가?** 아니다 — 이 시스템에는 이미 같은 규율의 선례가 있다. `production-progress` GET 은 휴식 설정이 코드 상수와 어긋나면 `break_config_matches: false` 를 실어 보내 클라이언트가 지표 계산을 **포기**하게 한다. 주석이 그 원칙을 이미 적어 두었다: *"틀린 숫자보다 없는 숫자가 낫다."* 그 원칙을 조회 실패에도 똑같이 적용하는 것뿐이다.

**회귀 테스트**: `supabaseAdmin` 을 목킹해 `{ data: null, error: {...} }` 를 주입 → `rejects.toThrow()`. 그리고 `{ data: null, error: null }` → `60` 반환. **두 경우가 다르게 동작하는 것이 이 수정의 전부**이므로 테스트도 두 경우를 반드시 나눠서 단언한다.

---

## 8. MEDIUM — Realtime 초기 구독에 이벤트 유실 창

**위치**: `src/hooks/useRealtimeData.ts:361-363`, `433-444`

### 검증 결과

코드 의도는 주석에 명확히 적혀 있다(300-302행):
> *구독을 이 시점에 열면 (a) 필터가 준비돼 있고 (b) 스냅샷 SELECT 가 구독 이후에 실행돼 그 사이 커밋된 변경을 모두 포함하므로 "조회↔구독 갭" 이벤트 유실이 없다*

**이 추론에는 두 개의 구멍이 있다.**

**구멍 1 — `.subscribe()` 는 즉시 SUBSCRIBED 가 아니다.** 363행 `afterScopeResolved()` 는 구독을 *시작*할 뿐이고, 실제 SUBSCRIBED 는 546행 콜백에서 비동기로 온다. 그 사이에 스냅샷 `SELECT` 가 이미 나간다. **SELECT 이후 ~ SUBSCRIBED 이전**에 커밋된 변경은 스냅샷에도 없고 이벤트로도 오지 않는다.

**구멍 2 (더 중요) — 스냅샷이 배열을 통째로 교체한다.** 433-444행:

```ts
setState(prev => ({
  ...prev,
  machines: machines || [],        // 통째 교체
  machineLogs: machineLogs || [],  // 통째 교체
  productionRecords,               // 통째 교체
```

SUBSCRIBED 가 스냅샷보다 **먼저** 완료돼 이벤트가 도착하면, 그 이벤트는 530행 `setState` 로 `prev.machineLogs` 에 정상 반영된다. 그런데 뒤늦게 도착한 스냅샷이 **그 배열을 통째로 덮어써 방금 반영한 이벤트를 지운다.** 구독을 먼저 여는 설계가 오히려 이 경로를 만들었다.

`loadSequenceRef` 가드(390행)는 **여러 번의 loadInitialData 사이**를 지켜줄 뿐, **한 번의 로드와 그 구독 이벤트 사이**는 지키지 못한다. 축이 다르다.

### 수정 방안 — 이벤트 버퍼 + 스냅샷 후 재생

"SUBSCRIBED 를 기다렸다가 스냅샷 조회"는 정확하지만 초기 렌더가 왕복 한 번만큼 늦어진다. 지연 없이 정확하게 하려면 **버퍼링**이 맞다.

```
1. 구독을 연다. SUBSCRIBED 이전/이후 상관없이, 도착하는 이벤트를
   snapshotAppliedRef.current === false 인 동안에는 setState 하지 않고
   pendingEventsRef 에 쌓기만 한다.
2. 스냅샷을 조회해 배열을 교체한다 (지금과 동일).
3. 같은 setState 안에서 pendingEventsRef 의 이벤트를 순서대로 재생하고,
   snapshotAppliedRef 를 true 로 올린 뒤 버퍼를 비운다.
4. 이후 이벤트는 지금처럼 즉시 적용한다.
```

**멱등성이 이 설계의 안전판이다.** 스냅샷에 이미 반영된 이벤트를 재생해도 `applyRealtimeMachineLog` 가 `log_id` 기준으로 갱신하므로 결과가 같다. 중복 걱정 없이 "일단 다 재생"할 수 있다.

**정리 경로 주의**: `cleanupChannels()`(재연결·언마운트)에서 `pendingEventsRef` 와 `snapshotAppliedRef` 를 함께 초기화해야 한다. 안 그러면 재연결 후 옛 세대 이벤트가 새 스냅샷 뒤에 재생된다.

**테스트 안**: `applyRealtimeMachineLog` 는 순수 함수이므로, "스냅샷 배열 + 버퍼 이벤트 목록 → 최종 배열"을 만드는 병합 함수를 별도로 분리해 Jest 로 검증한다. React 타이밍 자체를 테스트하려 하지 말고 **순서 규칙을 순수 함수로 밀어내는 것**이 요점이다.

---

## 9. LOW / 잠재 (등급 하향) — 관리자가 저장한 교대 종료 시각을 서버가 무시

### 검증 결과

| 층 | 동작 |
|---|---|
| `ShiftSettingsTab.tsx:65-72` | `shift_a_end`, `shift_b_end` 를 **저장한다** |
| 운영 DB | `shift_a_end = 20:00`, `shift_b_end = 08:00` 로 **실제 저장되어 있다** |
| `shiftConfig.ts:38-42` | `shiftAStart`, `shiftBStart` 만 **읽는다** |
| `downtimeIntervals.ts:206-211` | A교대 창 = `[aStart, bStart)`, B교대 창 = `[bStart, 다음날 aStart)` — **종료시각은 다음 교대 시작에서 파생** |

확인 완료. 현재 설정에서는 파생값과 저장값이 우연히 일치(A끝 20:00 = B시작 20:00)하므로 **아무 증상이 없다.**

관리자가 예컨대 A교대 종료를 19:30 으로 바꾸면, UI 는 저장에 성공했다고 하고 설정 화면에도 19:30 이 보이지만, **서버 OEE 시간창은 20:00 까지를 계속 A교대로 계산한다.** 조용히 어긋나는 것이 위험하다.

→ 현재 미발현이므로 **LOW**, 그러나 **UI 가 거짓말하고 있다**는 점에서 방치할 항목은 아니다.

### 수정 방안 — 두 갈래, 하나만 고른다

**방안 A (권장): UI 를 서버 모델에 맞춘다.**
종료시각 필드를 **읽기 전용 파생 표시**로 바꾼다. "A교대 종료: 20:00 (B교대 시작에서 자동)" 처럼 보여주고 저장하지 않는다. 기존 `shift_a_end`/`shift_b_end` 행은 `is_active = false` 로 내린다.

- 장점: 진실이 한 곳에만 있다. 코드 변경이 작고 위험이 없다.
- 이 시스템의 실제 모델은 **연속 2교대**다 — A가 끝나면 B가 시작한다. 간격이나 중첩은 애초에 표현할 수 없는 개념이고, 표현할 수 있는 척하는 UI 가 문제였다.

**방안 B: 서버가 종료시각을 읽게 한다.**
`buildShiftWindows` 가 `shiftAEnd`/`shiftBEnd` 를 받아 창을 만든다.

- 파급이 크다: 교대 사이 간격이 생기면 **그 시간대의 비가동은 어느 교대에 귀속되는가**, `buildBusinessRange`(업무일 정의)는 어떻게 되는가, 중첩 시 이중 계산은 어떻게 막는가 — 전부 새로 정의해야 한다.
- **실제 운영 요구가 확인되기 전에는 하지 않는다.**

→ **방안 A 로 진행하되, 사용자에게 "교대 사이 간격/중첩이 실제로 필요한가"를 확인한 뒤 확정한다.**

---

## 10. MEDIUM (신규 발견) — anon 역할에 핵심 테이블 전 DML grant 잔존

코덱스 감사에 없던 항목이다. #3 을 검증하며 grant 를 함께 조회하다 발견했다.

### 운영 DB 실측

| 테이블 | anon grants | authenticated grants |
|---|---|---|
| `machines` | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER | 동일 |
| `machine_logs` | 동일 | 동일 |
| `production_records` | 동일 | 동일 |
| `downtime_entries` | 동일 | 동일 |
| `user_profiles` | 동일 | 동일 |
| `system_settings` | 동일 | 동일 |
| `production_progress_reports` | **(없음)** | (없음) |
| `production_shift_states` | **(없음)** | (없음) |

### 판정 — 지금 당장 뚫려 있지는 않다

`20260715200000` 마이그레이션이 anon 정책을 모두 제거했고 모든 테이블에 RLS 가 켜져 있다(`relrowsecurity = true`). **정책이 없으면 거부**이므로 anon 은 현재 차단된다. 즉시 악용 가능한 구멍은 **아니다.**

문제는 **단일 실패점**이라는 것이다. 누군가 편의를 위해 anon 정책을 하나 추가하거나, RLS 를 잠시 끄고 되돌리지 않거나, 새 테이블에 이 grant 패턴을 복사하는 순간 — **테이블 전체가 인터넷에 열린다.** `NEXT_PUBLIC_SUPABASE_ANON_KEY` 는 브라우저 번들에 들어 있어 누구나 가진다.

`production_progress_reports` / `production_shift_states` 는 grant 자체가 없다. **새 테이블은 이미 옳은 패턴으로 만들어지고 있다** — 오래된 테이블만 정리되지 않았다.

### 수정 방안

```sql
-- 쓰기 grant 회수. 읽기는 RLS 정책이 판단하도록 SELECT 만 남긴다.
revoke insert, update, delete, truncate, references, trigger
  on public.machines, public.machine_logs, public.production_records,
     public.downtime_entries, public.user_profiles, public.system_settings
  from anon;

revoke all on public.machines, public.machine_logs, public.production_records,
              public.downtime_entries, public.user_profiles, public.system_settings
  from anon;   -- SELECT 까지 완전 회수 (anon 은 어떤 정상 경로에서도 쓰이지 않는다)
```

**적용 전 확인 — 이번 감사에서 완료했다.**
`src/lib/systemSettings.ts` 는 브라우저 클라이언트(`@/lib/supabase`)를 쓰므로 로그인 이전에는 anon 상태로 `system_settings` 를 조회할 수 있다. 그래서 이 경로가 깨질 위험을 우려했으나, 운영 정책을 확인한 결과:

```
"모든 인증된 사용자는 시스템 설정을 볼 수 있" | TO public | SELECT
  qual: (select auth.role()) = 'authenticated'
```

정책 대상은 `public` 이지만 술어가 `authenticated` 를 요구하므로 **anon SELECT 는 이미 거부된다.** grant 회수는 동작을 바꾸지 않는다 — 이미 막혀 있는 것을 문서화된 상태로 만들 뿐이다. → 안전하게 진행 가능.

나머지 5개 테이블(`machines`, `machine_logs`, `production_records`, `downtime_entries`, `user_profiles`)은 anon 정책이 아예 없으므로 마찬가지다.

**부수 작업**: `authenticated` 의 `TRUNCATE` / `REFERENCES` / `TRIGGER` grant 도 정상 앱 동작에 불필요하다. RLS 는 `TRUNCATE` 를 막지 못하므로 이것은 실질적 위험이다. 함께 회수한다.

---

## 11. 권장 처리 순서

수정은 **성격별로 브랜치를 나눈다.** 보안 수정과 동시성 수정을 한 PR 에 섞으면 리뷰가 불가능해지고, 하나가 막히면 나머지도 함께 멈춘다.

| 순서 | 브랜치 | 항목 | 마이그레이션 | 비고 |
|---|---|---|---|---|
| **0** | — | **#1 자격증명 회전** | 없음 | **사용자 직접 조치. 코드 작업보다 먼저** |
| 1 | `fix/claude-…-credential-leak` | #1 주석 삭제 + 스캔 테스트 | 없음 | 즉시 병합 가능 |
| 2 | `fix/claude-…-password-logging` | #2 + 유사 로깅 전수 | 없음 | 즉시 병합 가능 |
| 3 | `fix/claude-…-settings-fail-loud` | #7 | 없음 | 호출자 전수 필요 |
| 4 | `fix/claude-…-progress-shift-guard` | #5 | 있음(본문만, 시그니처 유지) | 마이그레이션 선적용 안전 |
| 5 | `fix/claude-…-edge-fn-authz` | #4 | Edge Function 배포 | service_role 분기 필수 |
| 6 | `fix/claude-…-realtime-buffer` | #8 | 없음 | 순수 병합 함수로 분리 |
| 7 | `fix/claude-…-rls-scope` | #3 + #10 | 있음(3단계 분할) | **EXPLAIN 전후 비교 필수** |
| 8 | `fix/claude-…-shift-end-ui` | #9 | 설정 비활성화 | 사용자 확인 후 |
| 9 | `fix/claude-…-close-shift-fingerprint` | #6 | 있음(`_v2` 신규 함수) | 마지막. 비용 대비 빈도 낮음 |

**7번(RLS)이 가장 위험하다.** 잘못 조이면 앱 전체가 조용히 빈 화면이 된다. 3-A → 3-B 를 반드시 나눠 적용하고, 각 단계마다 세 역할(admin / engineer / operator) 로 실제 로그인해 대시보드·설비목록·실적조회를 확인한 뒤 다음 단계로 간다.

**9번(마감 원자성)을 마지막에 두는 이유**: 발생 빈도가 가장 낮고 수정 비용이 가장 크며, 새 RPC 를 만들고 구 RPC 를 나중에 지우는 2단계 배포가 필요하다.

---

## 12. 이 감사에서 확정하지 못한 것

정직하게 남긴다.

- **실제 공격 재현을 하지 않았다.** operator JWT 로 PostgREST 를 직접 호출해 `machine_logs` 를 INSERT 해 보지 않았고, 비관리자 JWT 로 Edge Function 을 호출해 보지 않았다. 정책·grant·소스 정적 분석으로 판정했다. #1 의 자격증명 유효성도 시험하지 않았다.
- **운영 동시 쓰기를 재현하지 않았다.** #6 과 #5(b) 의 경쟁 창은 코드 구조로 판정했으며, 실제로 발생한 데이터 사례를 찾지는 않았다.
- **#3 수정의 성능 영향을 측정하지 않았다.** RLS 술어 추가가 32.5만 행 테이블의 실행계획에 미치는 영향은 `EXPLAIN ANALYZE` 전후 비교로만 확정할 수 있으며, 이는 수정 구현 단계의 작업이다.
- **`daily-oee-aggregation` 배포본은 논리적으로 동일함만 확인했다.** 주석 분량이 달라 바이트 단위로는 다르다. 실행 코드 경로에 차이가 없음을 육안 대조로 확인했다.
