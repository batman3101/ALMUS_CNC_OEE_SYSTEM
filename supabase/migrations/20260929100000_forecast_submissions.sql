-- Forecast 접수: 공장마다 마지막으로 '접수 확정'한 Forecast 검증 결과 하나를 기억한다 (사용자 결정 2026-09-29).
--
-- 결정
--   · 공장당 1행(factory_id 가 기본 키). 새로 접수 확정하면 덮어쓴다 — 이력은 두지 않는다.
--   · 저장 시점은 사람이 '접수 확정'을 누를 때다(검증 성공 즉시 자동 저장이 아니다). 시험 삼아 올린 파일이
--     이전 접수분을 덮지 않게 하기 위해서다.
--   · 파일 원본은 저장하지 않는다. 서버가 해석한 검증 결과(원본 행·날짜·수량·요약)만 저장한다.
--
-- ⚠ 설비 배치(모델·공정)와 T/T·CAPA 기준은 여기 저장하지 않는다.
--   변경 전 배치 = 앱 DB(machines) 의 현재 값, 시뮬레이션·확정 = 지정 주차의 수요 — 이 규칙 때문에
--   불러올 때마다 capacitySnapshot·capacityPolicy 를 DB 에서 새로 읽는다(src/lib/forecast/submission.ts).
--   검증 시점의 배치를 같이 저장하면, 셋업이 진행된 뒤에도 옛 배치로 계산하게 된다.
--
-- 쓰기·읽기 모두 서비스 롤 라우트(/api/forecasts/submission)만 한다. 브라우저에 직접 권한을 주지 않는다
-- (RLS 켜고 정책 없음 → authenticated 는 행이 보이지 않는다).

begin;

create table public.forecast_submissions (
  factory_id uuid primary key references public.factories(id),
  file_name text not null check (file_name <> '' and length(file_name) <= 240),
  source_hash text not null check (source_hash <> ''),
  parser_version text not null,
  sheet text not null,
  -- ForecastPreview 중 dates·rows·summary (src/types/forecast.ts). 서버가 파일을 다시 해석한 값이다.
  preview jsonb not null check (jsonb_typeof(preview) = 'object'),
  submitted_by uuid,
  submitted_at timestamptz not null default now()
);

comment on table public.forecast_submissions is
  '공장별 마지막 Forecast 접수(검증 결과만). 설비 배치는 저장하지 않는다 — 불러올 때 machines 에서 새로 읽는다.';

alter table public.forecast_submissions enable row level security;

revoke all on public.forecast_submissions from public, anon, authenticated;
-- 없으면 서비스 롤 라우트가 42501 로 깨진다.
grant all on public.forecast_submissions to service_role;

commit;
