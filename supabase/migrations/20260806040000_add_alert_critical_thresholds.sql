-- 알림 위험선 3개를 설정으로 승격한다. (2026-08-06)
--
-- ## 왜 필요한가
--
-- `/api/alerts` 는 지표 5개(OEE·가동률·성능·품질·다운타임)를 경고/위험 2단계로 판정하는데,
-- 그 10개 숫자가 전부 라우트 파일 안의 리터럴이었다. 관리자가 설정 화면에서 목표를 바꾸고
-- 저장에 성공해도 알림 판단은 그대로였고, 그걸 확인할 방법도 없었다(감사 2026-08-06 HIGH-02).
--
-- 설정에는 목표 4개(target_*)와 OEE 전용 임계값 2개(low·critical)뿐이라 가동률·성능·품질의
-- **위험선**을 표현할 자리가 없었다. 그래서 세 키를 새로 만든다.
--
--   경고선 = 목표 미달        → target_availability / target_performance / target_quality
--   위험선 = 위험 수준 도달   → 이 마이그레이션이 만드는 세 키
--
-- ## 기본값을 유추하지 않은 이유
--
-- OEE 의 위험/목표 비(0.6 / 0.85 ≈ 0.71)를 다른 지표에 적용하는 방법이 있었지만 쓰지 않았다.
-- 그 비율을 품질에 적용하면 위험선이 **75.7%** 가 되는데, 라우트에 하드코딩돼 있던 값은
-- **90%** 다. 공장에서 품질 75% 를 그제야 "위험" 이라 부르면 이미 늦다 — 비율은 그럴듯하지만
-- 도메인적으로 틀린 숫자를 만든다.
--
-- 그래서 아래 세 기본값은 유추가 아니라 **하드코딩돼 있던 현장 검증값을 그대로 옮긴 것**이다
-- (기존 ALERT_THRESHOLDS: availability 70 / performance 70 / quality 90). 이 마이그레이션의
-- 목적은 알림 동작을 바꾸는 게 아니라, 지금까지 코드에 갇혀 있던 숫자를 관리자에게 넘기는 것이다.
--
-- ## 적용 전에도 앱은 동작한다
--
-- `src/lib/settingsRegistry.ts` 가 같은 기본값을 들고 있고, `/api/alerts` 는 행이 없으면 그
-- 기본값으로 판정한 뒤 응답의 `metadata.threshold_fallbacks` 에 그 사실을 실어 보낸다.
-- 이 마이그레이션은 "기본값으로 도는 상태" 를 "관리자가 바꿀 수 있는 상태" 로 바꾼다.
--
-- ## 메타데이터에 대해
--
-- 기존 oee 행 7개는 전부 `data_type = 'string'`, `is_system = false`,
-- `description = '<key> setting'` 이다 — `update_system_setting` 의 INSERT 분기가 그렇게
-- 만들기 때문이고(20260714040000_role_based_rls.sql), 값이 숫자여도 그렇게 남는다.
-- 새 행은 올바른 메타데이터로 넣는다. 기존 7개의 `data_type` 은 **여기서 고치지 않는다** —
-- 값 판정의 권위는 이미 코드 쪽 레지스트리로 옮겼고, 이 마이그레이션은 한 가지 일만 한다.
--
-- ## 재실행 안전성
--
-- 관리자가 마이그레이션 적용 전에 설정 화면에서 저장했다면 RPC 가 이미 행을 만들어 두었을 수
-- 있다(느슨한 메타데이터로). 그 경우 **값은 건드리지 않고** 메타데이터만 바로잡는다.
-- 관리자가 고른 값을 마이그레이션이 되돌리면 그건 복구가 아니라 덮어쓰기다.
--
-- ## ⚠️ 이 표의 유일성은 (category, setting_key) 가 아니라 setting_key **단독**이다
--
--   system_settings_setting_key_key  UNIQUE (setting_key)
--
-- 즉 키 이름은 **카테고리를 가로질러** 전역으로 유일하다. 카테고리별 네임스페이스처럼 보이는
-- 구조라 이걸 모르면 다음 사람이 조용히 당한다 — 예컨대 `display.timezone` 을 추가하려 하면
-- 이미 `general.timezone` 이 있어서 INSERT 가 실패한다. 카테고리가 다르니 괜찮을 거라는
-- 짐작이 틀리는 자리다.
--
-- 그래서 아래 `on conflict` 는 대상을 명시한다. 대상 없는 `do nothing` 도 같은 효과지만,
-- 어떤 제약을 근거로 넘어가는지 적어 두는 편이 다음 사람에게 정직하다.
-- 새 키 세 개가 다른 카테고리의 기존 키와 겹치지 않는 것은 적용 전에 확인했다.

insert into public.system_settings
  (category, setting_key, setting_value, default_value, description, data_type, is_active, is_system)
values
  ('oee', 'critical_availability_threshold', '{"value": 0.7}'::jsonb, '{"value": 0.7}'::jsonb,
   '가동률 위험 임계값 (알림)', 'number', true, true),
  ('oee', 'critical_performance_threshold', '{"value": 0.7}'::jsonb, '{"value": 0.7}'::jsonb,
   '성능 위험 임계값 (알림)', 'number', true, true),
  ('oee', 'critical_quality_threshold', '{"value": 0.9}'::jsonb, '{"value": 0.9}'::jsonb,
   '품질 위험 임계값 (알림)', 'number', true, true)
on conflict (setting_key) do nothing;

-- 이미 있던 행(관리자가 먼저 저장한 경우)의 메타데이터만 정정한다. setting_value 는 제외.
update public.system_settings as s
set
  default_value = v.default_value,
  description   = v.description,
  data_type     = 'number',
  is_active     = true,
  is_system     = true
from (values
  ('critical_availability_threshold', '{"value": 0.7}'::jsonb, '가동률 위험 임계값 (알림)'),
  ('critical_performance_threshold',  '{"value": 0.7}'::jsonb, '성능 위험 임계값 (알림)'),
  ('critical_quality_threshold',      '{"value": 0.9}'::jsonb, '품질 위험 임계값 (알림)')
) as v(setting_key, default_value, description)
where s.category = 'oee'
  and s.setting_key = v.setting_key
  and (
    s.default_value is distinct from v.default_value
    or s.description is distinct from v.description
    or s.data_type is distinct from 'number'
    or s.is_active is distinct from true
    or s.is_system is distinct from true
  );
