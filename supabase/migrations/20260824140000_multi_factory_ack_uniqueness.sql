-- 알림 확인 이력의 유일성을 공장 범위로
--
-- 계약 4.3: "설비·모델·공정 이름의 유일성은 전역이 아니라 공장 범위다."
--
-- `alert_acknowledgements` 의 기존 유일성은 `(alert_key, user_id)` 였다. 지금은 alert_key 가
-- 설비 UUID 를 담고 있어서 두 공장의 키가 충돌하지 않지만, 그것은 **키 형식에 기댄 우연**
-- 이다. 알림 id 형식은 이미 한 번 바뀌었다(2026-08-21, updated_at -> 상태 시작 시각).
-- 다음에 형식이 바뀔 때 공장을 담지 않으면, 두 공장의 같은 종류 알림이 한 행을 공유하고
-- 한쪽에서 확인한 것이 다른 쪽에서도 확인된 것으로 보인다.
--
-- 우연을 제약으로 바꾼다.

begin;

alter table public.alert_acknowledgements
  drop constraint if exists alert_acknowledgements_alert_key_user_id_key;

-- 부분 인덱스가 아닌 진짜 제약으로 둔다 — upsert 의 onConflict 가 제약 이름이 아니라
-- 컬럼 목록을 쓰므로, 컬럼 조합이 유일 제약으로 존재해야 한다.
alter table public.alert_acknowledgements
  add constraint alert_acknowledgements_factory_alert_user_key
  unique (factory_id, alert_key, user_id);

commit;
