# Forecast 주별 최대 일수량 기반 Layout 배치 시뮬레이션 — 설계

- 날짜: 2026-09-25
- 브랜치: `design/forecast-layout-preview`
- 상위 문서: `docs/FORECAST_EQUIPMENT_PLANNING_PRD_2026-09-22.md` (6.2 기준 수식, 6.3 기간 제약), `docs/FORECAST_IMPLEMENTATION_STATUS.md`
- 상태: 사용자가 2026-09-25 채팅에서 설계 승인. 운영 DB 쓰기·마이그레이션·Layout 확정·배포는 범위 밖.

## 1. 목표

접수한 Forecast 파일에서 **사용자가 고른 주(월~일)** 의 모델별 **최대 일수량**을 수요로 삼아,
모델·공정별 필요대수와 현재 배치 대비 부족/여유를 계산하고, 여유 설비를 부족 모델로 옮기는
**재배치 검토안**(설비 번호 단위)을 `/forecast` 화면에 보여준다.

사용자 결정(2026-09-25):
- 구현 위치: 앱 `/forecast` 페이지 (HTML 시안 아님).
- 주 기준: 화면에서 주차 선택. 파일 날짜를 월~일로 묶는다.
- 모델 짝짓기: 이름 정규화 + 코드 안 별칭 목록. 미매칭은 계산 보류.
- 결과 범위: 필요대수 표 + 재배치 검토안까지.
- 예외 셀: 숫자 셀만으로 최대값. 빈칸=0. 오류 셀(#N/A 등)이 있으면 계산은 하되 경고. 소수는 올림.
- UI: 기존 `/forecast` 화면(antd 카드·표) 스타일 유지. 새 스타일 도입 없음.

## 2. 계산 위치 (결정: 접수 응답 스냅샷 + 브라우저 순수 함수)

`POST /api/forecasts/preview` 응답에 `capacitySnapshot` 을 추가한다. 화면은 이 응답 하나로
주차를 바꿀 때마다 즉시 다시 계산한다. 계산은 입력만 받는 순수 함수라 단위 테스트가 쉽다.

대안(시뮬레이션 API 신설, 파일 재업로드)은 주차마다 파일을 다시 보내야 하고 API 가 하나 더
늘어 이번 단계에서는 채택하지 않는다.

`capacitySnapshot` 은 읽기 전용이며 기존 권한(admin/engineer)과 `requireFactoryUser` 의 공장
범위를 그대로 따른다.

```ts
interface ForecastCapacitySnapshot {
  takenAt: string;                    // ISO, 서버 시각
  models: Array<{ id: string; name: string; isActive: boolean;
    processes: Array<{ id: string; name: string; order: number; tactTimeSeconds: number | null }> }>;
  machines: Array<{ id: string; name: string; location: string; isActive: boolean;
    modelId: string | null; processId: string | null }>;
}
```

조회 실패는 `capacitySnapshot: { status: 'unavailable' }` 로 응답하고 화면은 시뮬레이션 카드를
"설비·T/T 조회 실패" 로 표시한다. 임의 값으로 대체하지 않는다(기존 `capacityPolicy` 규약과 동일).

## 3. 주차와 수요 산출 — `src/lib/forecast/weeklyDemand.ts`

입력: `ForecastPreview.dates`, `ForecastPreview.rows`.

- 주 묶기: 각 날짜를 월요일 시작 주로 묶는다. 라벨은 ISO 주 번호(`W37`) 와 기간(`09-07~09-13`).
  파일이 주 중간에서 시작/끝나면 그 주는 `partial: true` 로 표시한다(계산은 한다).
- 모델별 일 수량: 같은 `model` 의 행이 여러 개(Vendor 가 다른 행 등)면 **같은 날짜끼리 합산**한다
  (PRD 6.2 "모델·공정·일 단위 합산 후 올림"). `processes` 가 비어 있는 행(미지원 공정)은 제외하고
  `excludedRows` 로 센다.
- 주 최대: 주 안의 날짜별 합산 수량 중 최대값. 숫자 셀만 본다. 빈칸은 0. 소수는 `Math.ceil`.
- 함께 남기는 것: `peakDate`, `numericDays`, `blankCells`, `errorCells`(error/missing_cache/invalid),
  `fractional: boolean`. `errorCells > 0` 이면 `warnings` 에 `error_cells`.
- CNC1·CNC2 는 같은 수량을 각각 쓴다(2026-09-22 결정).

출력:

```ts
interface ForecastWeek { key: string; label: string; start: string; end: string; dates: string[]; partial: boolean }
interface WeeklyModelDemand {
  model: string; week: string; peakQuantity: number; peakDate: string | null;
  numericDays: number; blankCells: number; errorCells: number; fractional: boolean;
  warnings: Array<'error_cells' | 'fractional' | 'partial_week' | 'no_numeric'>;
}
```

## 4. 모델·공정 짝짓기 — `src/lib/forecast/modelAliases.ts`

- 정규화: 공백 제거 + 대문자. `"ON 1" → "ON1"`, `"Canvas 2" → "CANVAS2"`.
- 별칭 표(코드 상수, 공장 무관 — 두 공장의 모델명이 같음): Forecast 정규화명 → DB 정규화명.
  실측(2026-09-25 운영 DB) 기준 실제 설비가 배치된 모델 중 필요한 별칭:
  `H8MAIN → H8M` (DB "H8 M"), `DIAMOND3 → DM3` (DB "DM 3").
  나머지는 자동 매칭되거나 미매칭. 미매칭 모델은 `unmapped` 목록으로 화면에 보여주고 계산 보류.
- 비활성 DB 모델(`is_active=false`, 예: "H8M")은 매칭 후보에서 뺀다.
- 공정 정규화: DB `process_name` 에서 공백·`#` 제거 후 `CNC1`/`CNC2` 만 인정
  (`"CNC #1"`, `"CNC # 1"` → CNC1). `CNC #0`, `CNC #2-1` 은 대상 밖(`otherProcess`) 으로 표시하며
  그 설비는 재배치 풀에 넣지 않는다.

## 5. 필요대수 — `src/lib/forecast/requiredMachines.ts`

- 설비 1대 일 CAPA = `calculateDailyCapacity(t, [{720, break}, {720, break}])`
  (`src/utils/productionCapacity.ts`, `DEFAULT_OPERATING_MINUTES`=720, break 는 `capacityPolicy.breakMinutes`).
  `capacityPolicy.status === 'unavailable'` 이면 전체 계산 보류.
- 필요대수 = `ceil(peakQuantity / dailyCapacity)`; `peakQuantity === 0` 이면 0.
- T/T 가 null·0·음수면 `status: 'no_tact'` 로 계산 불가.
- 현재대수 = 해당 모델·공정에 배치된 `isActive` 설비 수.
- 차이 = 필요 − 현재. 양수 부족, 음수 여유.

```ts
interface ModelProcessRequirement {
  forecastModel: string; dbModel: { id: string; name: string } | null; process: 'CNC1' | 'CNC2';
  processId: string | null; tactTimeSeconds: number | null; dailyCapacity: number | null;
  peakQuantity: number; required: number | null; current: number; gap: number | null;
  status: 'ok' | 'shortage' | 'surplus' | 'unmapped' | 'no_tact' | 'zero_demand';
  warnings: WeeklyModelDemand['warnings'];
}
```

## 6. 재배치 검토안 — `src/lib/forecast/reassignment.ts`

- 여유 풀(순서대로): ① 여유 모델·공정의 초과분(`current − required`), ② 모델 또는 공정 미배정 설비,
  ③ 이번 주 수요 0인 모델·공정의 설비. 다음 주(선택 주 + 1)에 수요가 있는 모델의 설비는 풀 안에서
  **마지막**에 두고 `nextWeekDemand: true` 로 표시한다(PRD 6.3 급증 모델 보호).
- 부족이 큰 모델·공정부터 풀에서 한 대씩 옮긴다. 1대 이동 = 변경 1건. 같은 그룹 안에서는 설비
  이름(`CNC-###`) 내림차순으로 뺀다 — 결과가 항상 같아야 한다(PRD 6.4 재현성).
- 풀이 바닥나면 `unresolved` 에 남은 부족량을 그대로 둔다. 탐색 실패를 불가능 판정으로 말하지 않는다.
- 미매칭·`no_tact` 모델의 설비는 풀에 넣지 않는다(정보가 없는 설비를 움직이지 않는다).
- 호환성·교체시간·JIG 는 미반영. 출력은 "검토안·CAPA 수량 기준만" 이다.

```ts
interface ReassignmentProposal {
  moves: Array<{ machineId: string; machineName: string; location: string;
    from: { model: string | null; process: string | null }; to: { model: string; process: 'CNC1' | 'CNC2' };
    reason: 'surplus' | 'unassigned' | 'zero_demand'; nextWeekDemand: boolean }>;
  unresolved: Array<{ dbModel: string; process: 'CNC1' | 'CNC2'; remaining: number }>;
  summary: { required: number; current: number; shortage: number; surplus: number; changes: number };
}
```

## 7. 화면 — `src/components/forecast/WeeklySimulationCard.tsx`

접수 완료 후 기존 파일 카드 아래에 카드 하나를 추가한다. 기존 antd `Card/Table/Statistic/Tag/Alert`
와 `ForecastWorkspace.module.css` 규칙을 그대로 쓴다.

1. 주차 선택(`Select`, 기본값 파일 첫 주). 부분 주는 라벨에 표시.
2. 요약 `Statistic` 4개: 필요 합계 / 현재 합계 / 부족 합계 / 변경 건수.
3. 모델·공정별 표: 모델(Forecast명 + DB명) · 공정 · 주 최대 일수량(날짜) · 1대 일 CAPA · 필요 · 현재 · 차이 · 상태/경고 태그. 정렬 규약은 `table-sorting-conventions` 메모리(NULL 은 맨 뒤) 를 따른다.
4. 재배치 목록 표: 설비 번호 · 위치 · 현재 모델/공정 → 변경 모델/공정 · 사유 · "다음 주 수요" 태그.
5. 미매칭 모델 목록(`Tag` 나열) 과 계산 제외 설비 수(CNC #0 등).
6. 상단 `Alert(warning)`: "검토안 · 호환성·교체시간 미반영 · 운영 적용 없음". 적용 버튼 없음.

`public/locales/{ko,vi}/forecast.json` 에 키 추가.

## 8. 테스트

- `weeklyDemand.test.ts`: 주 경계(월~일), 부분 주, 중복 행 합산, 빈칸 0, 오류 셀 경고, 소수 올림, 숫자 없는 주.
- `modelAliases.test.ts`: 정규화, 별칭, 비활성 제외, 공정 정규화(CNC #0 제외).
- `requiredMachines.test.ts`: CAPA 산식(기존 함수 재사용, cavity 미적용), ceil, T/T 없음, 수요 0.
- `reassignment.test.ts`: 풀 순서, 다음 주 수요 보호, 풀 소진 시 unresolved, 결정적 순서, 미매칭 설비 미이동.
- `route.test.ts`: `capacitySnapshot` 포함, 조회 실패 시 `unavailable`.
- 실제 파일 대조: `FORECAST_SAMPLE_PATH` 가 있을 때만 W37 첫 주 수요를 별도 SheetJS 판독과 대조.
- 브라우저: `npm run dev` 로 띄워 접수 → 주차 변경 → 표·제안 확인, 390px 가로 넘침 없음.

## 9. 범위 밖

DB 쓰기·마이그레이션, Layout 확정/이력, 호환성·교체시간 반영, AI 호출, HTML 시안 변경, main 병합.
