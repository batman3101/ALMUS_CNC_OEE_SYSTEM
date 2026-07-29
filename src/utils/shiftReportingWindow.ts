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
