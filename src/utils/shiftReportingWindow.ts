import type { Interval } from '@/utils/downtimeIntervals';

/**
 * 진행 보고(`POST /api/production-progress`)를 받아도 되는 교대인지 판정한다.
 *
 * 왜 필요한가 — 라우트도 `report_shift_progress` RPC 도 인자로 받은 (date, shift)를 서버
 * 시각과 대조하지 않았다(Codex 감사 2026-07-29 #5). 담당 설비를 가진 운영자가 API 를 직접
 * 호출하면 **임의의 과거·미래 교대**에 진척을 삽입할 수 있었고, 그 값은 교대 마감이
 * `output_qty` 로 승격시킨다. 즉 과거 실적과 backlog 를 오염시킬 수 있었다.
 *
 * 왜 순수 함수인가 — 판정 규칙(경계 포함/제외, 유예 적용 방향)이 이 결함의 핵심인데,
 * DB·시각·요청을 다 엮은 채로는 경계값을 시험하기 어렵다. 규칙만 떼어내면 자정을 넘는
 * B교대까지 표로 검증할 수 있다.
 *
 * 왜 라우트 층인가 — 이 판단의 재료는 **서버 시각과 교대 설정**뿐이라 경쟁하는 쓰기가
 * 없다. "판단과 쓰기는 같은 잠금 아래" 규약은 경쟁 상대가 있는 판단(설비 활성 여부 등)을
 * 위한 것이므로, 그런 판단은 RPC 안 잠금 아래에 따로 둔다.
 */
export type ReportingWindowVerdict = 'open' | 'not_started' | 'closed';

export function classifyReportingWindow(
  window: Interval,
  bufferMinutes: number,
  nowMs: number,
): ReportingWindowVerdict {
  // 음수 유예는 창을 좁히는 방향이라 의도치 않은 거부를 만든다. 0 으로 바닥을 친다.
  const graceMs = Math.max(0, bufferMinutes) * 60_000;

  if (nowMs < window.start) return 'not_started';
  // 종료 시각 자체는 아직 열린 것으로 본다(창은 [start, end) 이지만 유예가 그 뒤를 덮는다).
  if (nowMs >= window.end + graceMs) return 'closed';
  return 'open';
}

/**
 * 교대 마감을 받아도 되는가.
 *
 * 왜 별도 산술이 아니라 `classifyReportingWindow` 를 **재사용**하는가 — 이게 이 함수의
 * 존재 이유다. 예전에는 두 규칙이 서로 다른 파일에서 각자 계산했다:
 *   진척 허용 종료 = window.end + buffer   (이 파일)
 *   마감 허용 시작 = window.end            (close-shift 라우트)
 * 그 결과 운영값 기준 **10분간 두 창이 겹쳤고**, 그 사이 승인된 진척 110 을 마감이 읽어둔
 * 100 이 덮어써 원천과 확정 레코드가 어긋날 수 있었다(적대적 재감사 #5).
 *
 * 겹침을 없애는 방법으로 "마감 쪽에도 buffer 를 더한다"를 고를 수도 있었다. 그러면 같은
 * 산술이 두 곳에 생기고, 언젠가 한쪽만 바뀐다 — 애초의 결함이 정확히 그 모양이었다.
 * 그래서 마감을 **진척 창이 'closed' 인 것과 같은 말**로 정의한다. 두 창의 서로소 성질이
 * 정의상 참이 되어, 유예 정책을 어떻게 바꾸든 겹칠 수 없다.
 */
export function isShiftCloseAllowed(
  window: Interval,
  bufferMinutes: number,
  nowMs: number,
): boolean {
  return classifyReportingWindow(window, bufferMinutes, nowMs) === 'closed';
}
