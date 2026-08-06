-- 구 `close_shift_upsert_v2` 제거 — 3단계 배포의 마지막 단계.
--
-- ## 왜 두 단계로 나눴나
--
-- 하향 마감 사유를 받으려면 인자가 둘 필요했다(`p_below_progress_reason`, `p_actor_id`).
-- `create or replace` 는 인자 목록이 다르면 덮어쓰지 않고 **오버로드**를 만들고, 한
-- 마이그레이션에서 v2 를 DROP 까지 하면 마이그레이션과 코드 배포 사이에 어느 순서로도 피할 수
-- 없는 "함수 없음" 창이 생긴다(PostgREST 스키마 캐시 리로드 지연까지 겹친다).
--
-- 그래서 새 이름으로 만들고 v2 를 남겼다. 순서는 이렇게 갔고, 어느 시점에도 호출되는 함수가
-- 없는 구간이 없었다:
--
--   ① 20260804130000 적용 (v3 추가, v2 유지)   → 옛 코드는 v2 를 계속 사용
--   ② PR #40 머지 → 배포 READY (4b01d23)       → 새 코드가 v3 사용
--   ③ 이 마이그레이션                            → 아무도 안 쓰는 v2 제거
--
-- `close_shift_upsert` v1 → v2 때(20260729170000)와 같은 절차다.
--
-- ## DROP 전 확인한 것
--
--   · 프로덕션 배포 READY, 커밋 4b01d23(= v3 를 호출하는 코드)
--   · 저장소에 v2 를 호출하는 코드 없음 — 앱은 v3, 불변조건 스크립트
--     (`supabase/tests/shift_write_invariants.sql`)도 같은 변경에서 v3 로 옮겼다
--   · v2 를 참조하는 DB 객체(함수·트리거·뷰) 0개
--   · 남은 언급은 전부 주석 (왜 이 규약이 생겼는지 설명하는 문장들)
--
-- ⚠ 이 파일이 참조하는 불변조건 스크립트를 **함께** 옮기지 않으면, 그 스크립트가 운영
-- 스키마에서 통째로 실패한다. v1 제거 때 실제로 그렇게 됐고(적대적 재감사 #7), 검사가 스스로
-- 깨진 채 방치되면 "검사가 있다"는 사실이 오히려 안전하다는 착각을 만든다.

drop function if exists public.close_shift_upsert_v2(
  uuid, date, text, integer, integer, integer, integer, numeric, numeric, integer, integer,
  timestamptz, timestamptz, text
);
