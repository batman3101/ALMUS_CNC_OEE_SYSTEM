# 16개 버그 수정 브라우저 검증

- 실행 일시: 2026-07-15 (Asia/Bangkok)
- 대상: `bug-fix-codex-20260715-080308`
- 앱: Next.js 개발 서버 `http://localhost:3000`
- 브라우저: Chrome 150 headless, 1440×1000
- 방식: 실제 Chromium DOM/화면 캡처, 동일 origin `fetch`, 서버 API 경계 확인

## 화면 확인

| 경로 | 결과 |
|---|---|
| `/reports` | 리포트 설정, OEE 카드, 일/주/월 미리보기와 PDF/Excel 버튼 렌더링 확인 |
| `/data-input` | route HTML/hydration 확인; 운영 데이터 보호를 위해 자동 저장 동작은 수행하지 않음 |
| `/analytics` | route HTML/hydration 확인 |

증거:

- [보고서 화면](./reports-route.png)

## 실제 데이터 API 확인

| 검증 | 결과 |
|---|---|
| 2026-04-01~2026-07-15 OEE 원본 범위 | HTTP 200, `total=142,822`, `returned=1`, `has_more=true` |
| 원본 페이지 1/2 경계 | 각 5,000건, 합계 10,000건, 고유 ID 10,000건(중복 0) |
| 사용자 지정 일별 집계 범위 | HTTP 200, 96개 기간, 첫 날짜 `2026-04-01`, 마지막 날짜 `2026-07-13` |
| B교대 단일 영업일 다운타임 | HTTP 200, 다음 날 08:00까지 포함한 분석 응답 확인 |
| 생산실적 목록 | HTTP 200, `total=326,971`, 첫 페이지 100건 |

## 브라우저 콘솔/네트워크

- 앱 서버 API 4개는 모두 HTTP 200이었다.
- headless Chrome 격리 환경에서 브라우저의 Supabase 외부 직접 요청은 `ERR_NETWORK_ACCESS_DENIED`로 차단됐다. 동일 데이터를 읽는 Next.js 서버 API는 정상 응답했다.
- 개발 모드에서 기존 theme class hydration 경고가 관찰됐다. 이번 16개 버그 수정에서 새로 추가된 예외 또는 React crash는 없었다.
- 신규 원자 저장 RPC는 migration 적용 전 원격 DB에는 존재하지 않으므로, 운영 데이터에 쓰기를 발생시키는 브라우저 저장 테스트는 수행하지 않았다. UI payload와 migration 계약은 Jest 회귀 테스트로 검증했다.

## 판정

- 읽기/집계/페이지네이션/화면 렌더링: 통과
- 생산실적+비가동 원자 저장: 코드·계약 테스트 통과, 실제 DB migration 적용 후 운영 전 smoke test 필요
- 독립 리뷰 후 추가된 데이터 손실 방지 경로까지 포함해 Jest 12개 스위트, 61개 테스트 및 프로덕션 빌드 통과
