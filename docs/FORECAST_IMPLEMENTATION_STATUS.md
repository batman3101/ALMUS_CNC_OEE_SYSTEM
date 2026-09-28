# Forecast 구현 진행 기록

- 기준: PRD v0.8, 사용자 구현 착수 승인 및 기존 OEE CAPA 재사용 결정(2026-09-22).
- 브랜치: `design/forecast-layout-preview`. 현재 브랜치에서 작업하며 main 병합·원격 push·배포는 수행하지 않음.
- 이번 구현 단위: **P1의 Excel 접수 미리보기·검증 및 P2의 기존 CAPA 공통 기반**. 전체 Forecast/Layout 기능이 완료된 상태는 아님.

## 구현 내용

1. `/forecast`: 기존 공장 컨텍스트·페이지 권한·사이드바에 연결. admin/engineer는 접수, operator는 기존 권한 표에 따라 잠금 표시. 한국어/베트남어 제공.
2. `POST /api/forecasts/preview`: 인증 및 공장 기대값 검사, 스트리밍 파일 크기 제한, XLSX 실제 ZIP 구조/해제 크기 검사, SHA-256·원본 셀·날짜 반환. 파일과 결과는 DB에 쓰지 않음.
3. ALMUS 단일 시트 어댑터: 헤더 검증, 병합된 모델 표시/Vendor만 범위 안에서 해석. CNC 원본 숨김 열도 읽고 CL-DB/TRI는 제외. CNC1~2는 동일 수량이 각 공정에 필요한 계약이며 CNC35는 매핑 보류.
4. 빈값·0·오류·수식 저장값 없음·유효하지 않은 수량·소수·중복 행을 구분. 숫자 소계는 완전한 수요나 확정 수량으로 표시하지 않음. 날짜 필터·행 펼침으로 원본 확인.
5. 기존 OEE 공식을 `src/utils/productionCapacity.ts`로 추출하고 `ShiftDataInputForm`에서 재사용. 기존 유효 입력 결과를 회귀 테스트로 고정. 교대별 내림 후 합산, 휴식/cavity/효율 중복 적용 없음.
6. 접수 응답에 같은 공장의 기존 OEE 교대/휴식 설정을 포함. 설정 조회 실패는 unavailable로 표시하며 임의 60분으로 대체하지 않음. 업로드 중 공장이 바뀌면 응답 폐기·요청 취소·화면 초기화.
7. **(2026-09-25) 주별 배치 시뮬레이션 카드.** 수요 기준은 사용자 결정대로 **선택한 주(월~일)의 모델별 최대 일수량**(주간 합계·평균 아님). 같은 모델의 여러 행은 날짜별로 먼저 합산. 빈칸 0, 오류 셀은 계산하되 경고, 소수 올림. 주차는 ISO 주 번호와 날짜 범위로 표시하고 부분 주를 구분. 설계 스펙 `docs/superpowers/specs/2026-09-25-forecast-weekly-peak-simulation-design.md`.
8. 접수 응답에 공장 스냅샷(`capacitySnapshot`: 모델·공정 T/T, 설비 800대의 현재 모델·공정) 추가. 5,000행 한도에 닿으면 잘린 결과 대신 unavailable. 계산은 브라우저 순수 함수 4개(`weeklyDemand`·`modelAliases`·`requiredMachines`·`reassignment`)가 수행하며 DB 쓰기 없음.
9. 모델 짝짓기는 공백·대소문자 정규화 + 코드 별칭 2개(H8 MAIN→H8 M, Diamond3→DM 3). 미매칭은 계산 보류로 목록 표시. DB 공정명 `CNC #1`/`CNC # 1`→CNC1, `CNC #2`→CNC2, `CNC #0`·`CNC #2-1` 설비는 대상 밖으로 집계. 필요대수 = ceil(주 최대 일수량 ÷ 1대 일 CAPA), CAPA 는 기존 `calculateDailyCapacity`(교대 720분×2, 휴식 차감, cavity 미적용). 재배치 검토안은 여유→미배정→수요 0 순으로 한 대씩 옮기고, 다음 주 수요가 있는 모델의 설비는 마지막에 두며 표시. 설비 번호 내림차순 고정으로 결과가 재현됨. 풀이 부족하면 남은 수량을 그대로 표시. 호환성·교체시간·JIG 미반영, 운영 적용 버튼 없음.

## 실행·검증

앱 실행: `npm run dev`, 로그인 후 사이드바의 **Forecast 생산계획** 또는 `/forecast`.

```powershell
$env:FORECAST_SAMPLE_PATH='C:/Work Drive/APP/CNC OEE 참조파일/ALMUS TECH FORECAST W39 update B7.xlsx'
node node_modules/jest/bin/jest.js --runInBand src/lib/forecast src/app/api/forecasts src/components/forecast src/utils/__tests__/productionCapacity.test.ts src/components/data-input/__tests__/ShiftDataInputForm.operationalContract.test.ts src/lib/__tests__/pageAccess.test.ts src/components/layout/__tests__/sidebarMenuTiers.test.tsx
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run lint
npm run build
```

실제 파일 경로는 로컬 검증용이다. CI에서는 합성 XLSX fixture를 사용하며 `FORECAST_SAMPLE_PATH`가 없으면 원본 파일 대조 테스트 하나만 건너뛴다. 파일을 저장소에 복사하지 않는다.

검증 결과는 작업 종료 시 아래에 기록한다. API 테스트의 인증·설정은 mock이며 실제 운영 DB 권한/RLS·실사용 로그인 검증을 대체하지 않는다.

## 다음 구현 순서

1. 공장별 모델·공정 매핑(별칭 2개 외 미매칭 56개 모델 정책)과 검증된 Forecast 버전 저장 및 RLS migration.
2. ~~기존 CAPA 함수 기반 필요대수·부족량·최소 변경 추천~~ → 2026-09-25 주별 최대 일수량 기준으로 1차 완료. 남은 것: 날짜별 가동·휴무·부분일 조건, 교체시간/호환성 입력.
3. 실제 앱의 공간 배치/확정 Layout 이력, 수동 조정·잠금·재검증. 기존 HTML 시안은 별도 참조이며 운영 연결 전.
4. 실제 생산 배정 구간·T/T 보호를 선행한 뒤 원자적 Layout/설비정보 즉시 적용과 현장 셋업 작업 관리.
5. 공급자 선정 및 서버 비밀 설정 후 AI 매칭/설명 API 연결. AI가 계산·DB 쓰기·확정을 직접 수행하지 않음.

현재 접수 화면은 미리보기이며 DB 접수 확정, 실제 설비 번호 추천, Layout 확정 적용, 셋업 상태의 서버 공유, 외부 AI 호출을 제공한다고 표시하지 않는다.

## 2026-09-22 검증 결과

- 관련 Jest **8개 스위트, 109개 테스트 PASS**. 합성 파일·실제 사용자 파일·API 권한/공장/입력 오류·설정 재사용·CAPA 회귀·화면 공장 전환·재시도·언어 키·기존 메뉴 권한 포함.
- 실제 Forecast: 73 CNC 행, 72 모델, 77일, W39 숫자 합계 326464.70588235295 및 빈 셀 24개, SHA-256 일치.
- `tsc --noEmit --incremental false`: PASS.
- `npm run lint`: 오류 0, 기존 코드 경고 19. 기존 Sidebar 테스트의 React act 경고는 남아 있으며 새 Forecast 테스트에는 같은 경고가 없음.
- `npm run build`: PASS. `/forecast`와 `/api/forecasts/preview` 빌드 확인.
- 실제 production build의 Playwright 검증: admin/ko, engineer/vi 파일 선택→원본 파싱→기간 필터→원본 셀 펼침, operator 화면 차단, 390px 페이지 가로 넘침 없음, JS 오류 없음. 모든 외부 요청과 인증/DB 설정은 mock으로 대체하여 운영 서비스에 요청하지 않음.
- 브라우저 스크립트: `scripts/verify-forecast-browser.cjs`. 먼저 `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100` 실행 후 같은 샘플 환경변수로 스크립트를 실행. Playwright 경로는 `PLAYWRIGHT_MODULE`로 교체 가능.
- 화면/결과: `docs/previews/forecast-input/`. 스크린샷의 시간·휴식 설정과 계정은 가상값이며 운영 설정 실측으로 사용하지 않음.
- 변경 파일 자체 검토와 테스트를 수행했으나 별도 검토자의 승인이나 운영 인증/RLS 시험은 아직 없음. 운영 DB 마이그레이션·설비 변경·배포 없음.

## 2026-09-25 검증 결과 (주별 배치 시뮬레이션)

- 관련 Jest **13개 스위트, 92개 테스트 PASS** (실제 파일 포함). 새 스위트: `weeklyDemand`(주 경계·부분 주·중복 행 합산·오류 셀·소수·실제 파일 11주 대조), `modelAliases`, `requiredMachines`, `reassignment`, `capacitySnapshot`, `WeeklySimulationCard`.
- `tsc --noEmit --incremental false`: PASS. `npm run lint`: 오류 0, 기존 경고 19. `npm run build`: PASS.
- 브라우저(프로덕션 빌드 + Playwright, `scripts/verify-forecast-simulation.cjs`): admin/ko, engineer/vi 모두 PASS. 주차 11개(W37 기본, W47 마지막), W40 으로 바꾸면 재계산, H8 MAIN 행에 DB 모델 H8 M 표시, 미매칭 목록, 재배치 표(설비 번호·현재→변경·사유), 운영 적용 버튼 없음, 390px 가로 넘침 없음, JS 오류 없음. 결과 `docs/previews/forecast-input/simulation-verification.json`, 화면 `simulation-admin-ko-desktop.png`·`simulation-admin-ko-mobile.png`(vi 도 동일 이름 규칙).
- 검증에 쓴 설비 스냅샷은 운영 DB ALT 를 **읽기 전용으로 덤프**한 실제 값(모델 32, 설비 800)이며 인증·설정 응답은 mock. 실제 파일 W37 기준 결과: 필요 1,000대 / 현재 768대 / 부족 266대 / 옮길 수 있는 설비 39대 — 여유 풀이 작아 대부분의 부족은 해소되지 않는다고 표시된다(T/T·교대 720분 가정 기준의 검토안).
- 주차 라벨은 ISO 주 번호다. 파일명의 "W39" 가 회사 자체 주차 표기라면 번호가 다를 수 있으므로 화면에 날짜 범위를 함께 표시했다. 현장 표기와 맞는지 사용자 확인 필요.
- 운영 DB 마이그레이션·설비 변경·배포·main 병합 없음.
