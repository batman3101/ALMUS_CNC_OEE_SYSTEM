-- production_records.defect_qty 를 NULL 허용으로. NULL = "미검사"(불량 결과가 다음날 검사에서
-- 나옴). 0 과 구분해야 한다(NULL≠0%): 미검사는 품질/OEE 를 계산할 수 없다. 스냅샷 필드
-- (quality/oee/performance)는 이미 nullable. 기존 행(모두 값 있음)·경로는 영향 없음(additive).
alter table public.production_records
  alter column defect_qty drop not null;
