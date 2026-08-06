-- 현행 설정 계약 밖의 레거시 키 11개를 비활성화한다. (2026-08-06 실측)
--
-- ## 어떻게 쌓였나
--
-- `update_system_setting` 은 (category, setting_key) 로 행을 찾지 못하면 **새로 INSERT 한다**
-- (20260714040000_role_based_rls.sql). 저장 API 는 카테고리·키가 빈 문자열인지만 봤다. 그래서
-- 오타 한 번, 옛 코드 경로 한 번이 그대로 영구 활성 행이 됐다. `general.test_setting` 은 그
-- 경로가 남긴 흔적이고, `ui.language` 는 값이 `{"value":{"value":"vi"}}` 로 **이중 중첩**돼
-- 있다 — RPC 가 `{...}` 모양 문자열을 jsonb 로 한 번 더 파싱해서 생긴 모양이다. 계약에 없는
-- 키라 아무도 읽지 않으니 그 기형이 드러난 적도 없다.
--
-- 이 구멍은 같은 브랜치에서 닫혔다: `src/lib/settingsRegistry.ts` 가 단일 계약이 되고
-- `/api/system-settings/update` 가 계약 밖 키를 거부한다. **새 쓰레기는 더 이상 들어오지
-- 않는다.** 이 마이그레이션은 이미 들어와 있는 것의 정리다.
--
-- 계약의 **개수는 여기 적지 않는다.** 처음엔 "32개짜리"라고 적었는데, 같은 날 오후에 알림
-- 임계값 3개가 들어와 35개가 됐다. 개수는 이 마이그레이션이 무엇을 하는지와 아무 상관이 없고,
-- 적어 두면 계약이 자랄 때마다 갱신해야 하는 자리가 하나 더 생길 뿐이다 — 이 정리 작업이
-- 치우고 있는 결함(같은 목록이 세 군데에 따로 적혀 따로 자란 것)과 정확히 같은 종류다.
-- 계약과 이 목록이 겹치지 않는다는 사실은 숫자가 아니라 테스트가 보증한다.
--
-- ## 왜 DELETE 가 아니라 is_active = false 인가
--
-- 이 표가 이미 정한 전례다 — `shift.shift_hours` 가 2026-07-13 에 같은 방식으로 은퇴했고
-- (지금도 `is_active = false` 로 남아 있다), 설정 삭제 API 도 행을 지우지 않고 비활성화한다
-- (`src/app/api/system-settings/route.ts`). 읽는 쪽은 전부 `.eq('is_active', true)` 로 거르므로
-- (`src/lib/systemSettings.ts`, `api/system-settings/service-role`) 비활성화만으로 화면·서버에서
-- 사라진다. 되돌리려면 `is_active = true` 한 번이면 되고, 값과 감사 이력은 그대로 남는다.
--
-- ## 은퇴 시점의 값 — 무엇이 사라지는지 남겨 둔다
--
-- 값을 현행 키로 **옮기지 않는다.** 현행 값이 살아 있는 진실이고 아래는 아무도 읽지 않은 채
-- 굳은 값이다. 다만 나중에 "뭔가 유실된 것 아닌가"를 판단할 수 있어야 하므로 적어 둔다.
-- `updated_at` 을 같이 적는 이유는, 대부분이 2025년에 멈춰 있다는 사실 자체가 "관리되지 않는
-- 값"이라는 증거이기 때문이다.
--
--   레거시 키                        은퇴 시점 값        최종 수정      현행 대응 키 (= 살아 있는 값)
--   ------------------------------------------------------------------------------------------------
--   display.refresh_interval         30                 2025-08-21   display.dashboard_refresh_interval_seconds = 30
--   display.theme                    "light"            2025-08-18   display.theme_mode = "light"
--   general.test_setting             "test_value"       2025-09-07   (대응 키 없음 — 시험 삽입의 잔해)
--   notification.email_enabled       true               2025-08-21   notification.email_notifications_enabled = false  ⚠
--   oee.availability_target          90   (%)           2025-08-18   oee.target_availability = 0.9
--   oee.oee_target_percentage        85   (%)           2025-08-18   oee.target_oee        = 0.85
--   oee.performance_target           95   (%)           2025-08-18   oee.target_performance = 0.95
--   oee.quality_target               99   (%)           2025-08-18   oee.target_quality    = 0.99
--   shift.shift_a_end                "20:00"            2026-07-13   (저장하지 않고 유도 — shift_b_start = "20:00")
--   shift.shift_b_end                "08:00"            2026-07-13   (저장하지 않고 유도 — shift_a_start = "08:00")
--   ui.language                      {"value":"vi"}     2026-07-13   general.default_language = "vi"
--
-- ⚠ **실제로 갈라진 것은 `notification.email_enabled` 하나뿐이다.** 레거시는 `true`, 현행
--   `notification.email_notifications_enabled` 는 `false` 다. 그래도 옮기지 않는다 — 현행 키는
--   알림 탭이 실제로 저장하는 키이고 `false` 는 관리자가 그렇게 둔 상태다. 레거시 `true` 를
--   옮기면 **아무도 켠 적 없는 이메일 알림이 이 마이그레이션 때문에 켜진다.**
--
--   OEE 4개는 값이 다른 것이 아니라 **단위가 다르다**(퍼센트 vs 비율). 90/0.9, 85/0.85,
--   95/0.95, 99/0.99 는 지금 서로 같은 목표를 가리킨다. 다만 그것은 우연이다 — 레거시 쪽은
--   2025-08-18 이후 한 번도 갱신되지 않았고 현행 쪽은 2026-08-06 에 갱신됐다. 다음에 목표를
--   바꾸면 조용히 갈라졌을 것이다.
--
--   `shift_a_end`/`shift_b_end` 는 서버가 **읽지 않는다.** 교대 창을
--   `A = [A시작, B시작)`, `B = [B시작, 다음날 A시작)` 으로 유도하기 때문이다(`buildShiftWindows`).
--   저장된 종료 시각이 살아 있으면 관리자가 설정한 값처럼 보이지만 실제로는 아무 효력이 없다.
--
-- ## 왜 "계약에 없는 키 전부"로 쓰지 않는가
--
-- 계약은 TypeScript(`settingsRegistry.ts`)에 있고 SQL 은 그것을 볼 수 없다. `setting_key not in
-- (...)` 같은 일반 술어를 쓰면, 이 마이그레이션보다 **늦게 적용되는 새 키가 추가되는 순간
-- 그 키까지 꺼 버린다.** 그래서 11쌍을 그대로 열거한다. 열거한 목록이 계약과 겹치지 않는지는
-- `supabase/migrations/__tests__/legacySettingsRetirement.test.ts` 가 양쪽을 읽어 검사한다.
--
-- ## 행의 정체는 `setting_key` 하나다 — `(category, setting_key)` 가 아니다
--
-- 이 표는 카테고리별 이름공간이 있는 것처럼 읽히지만, 실제 제약은 전역이다:
--
--   system_settings_setting_key_key  UNIQUE (setting_key)
--
-- 즉 `theme` 라는 키는 카테고리를 통틀어 **하나뿐**이다. 그래서 아래 UPDATE 가 카테고리까지
-- 함께 보는 것은 행을 특정하기 위해서가 아니라, 목록이 사람 눈에 계약과 대조 가능한 형태로
-- 남게 하기 위해서다. 카테고리를 함께 보면 "카테고리가 어긋난 행을 놓칠 수 있다"는 반대
-- 위험이 생기는데, 2026-08-06 실측으로 그렇지 않음을 확인했다 — `setting_key` 만으로 매칭해도
-- 정확히 같은 11행이 나오고 11행 모두 카테고리가 일치한다.
--
-- 부수적으로: 감사 §5.2 가 "중복 활성 행을 막는 유일성 제약"을 새로 만들자고 했는데, 위
-- 제약이 이미 그것보다 강하다. 키당 행이 하나뿐이라 중복 활성 행 자체가 존재할 수 없다.
--
-- ## 재실행 안전성
--
-- `is_active is distinct from false` 로 아직 켜져 있는 행만 고른다. 두 번째 실행은 0행을
-- 건드리므로 `updated_at` 도 흔들리지 않는다. 목록의 행이 이미 없어도 매칭되지 않을 뿐이다.

do $$
declare
  v_deactivated integer;
begin
  with legacy(category, setting_key) as (
    values
      ('display',      'refresh_interval'),
      ('display',      'theme'),
      ('general',      'test_setting'),
      ('notification', 'email_enabled'),
      ('oee',          'availability_target'),
      ('oee',          'oee_target_percentage'),
      ('oee',          'performance_target'),
      ('oee',          'quality_target'),
      ('shift',        'shift_a_end'),
      ('shift',        'shift_b_end'),
      ('ui',           'language')
  )
  update public.system_settings s
     set is_active  = false,
         updated_at = now()
    from legacy l
   where s.category    = l.category
     and s.setting_key = l.setting_key
     and s.is_active is distinct from false;

  get diagnostics v_deactivated = row_count;

  -- 최초 적용은 11, 재실행은 0 이 정상이다. 그 외의 숫자는 "누가 이미 일부를 껐거나 지웠다"는
  -- 뜻이므로, 조용히 넘어가지 않고 로그에 남긴다.
  raise notice '레거시 설정 키 비활성화: %건 (최초 적용 기대치 11, 재실행 기대치 0)', v_deactivated;
end $$;
