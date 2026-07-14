import { format, subDays } from 'date-fns';

export type ReportTemplate = 'daily' | 'weekly' | 'monthly';

/**
 * 빠른 보고서 템플릿이 포함하는 날짜 수 (양끝 포함).
 *
 * 이전 구현은 두 가지가 틀려 있었다:
 *
 *  1. `new Date().toISOString()` 으로 오늘을 구했다. toISOString() 은 UTC 로 변환하므로,
 *     공장 현지시간(UTC+7)으로 00:00~06:59 사이에는 "오늘"이 전날로 나온다.
 *     그 시간대는 B(야간)조 근무 중이라 하필 사람이 보고서를 뽑는 시간이다.
 *
 *  2. 날짜 범위가 양끝 포함(inclusive)인데 1일/7일을 그대로 빼서,
 *     일간 보고서가 2일치, 주간 보고서가 8일치를 담았다.
 *     월간은 setMonth(-1) 로 최대 31일을 요청했지만 페이지는 30일만 조회하므로,
 *     가장 앞 하루가 조용히 비어 있었다.
 *
 * 여기서는 현지 달력 날짜(date-fns format)를 쓰고, 이름과 실제 일수를 일치시킨다.
 */
export const REPORT_TEMPLATE_DAYS: Record<ReportTemplate, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30
};

/** 빠른 보고서가 조회해야 하는 최대 기간. 페이지의 데이터 조회 윈도우는 이보다 짧으면 안 된다. */
export const MAX_REPORT_TEMPLATE_DAYS = Math.max(...Object.values(REPORT_TEMPLATE_DAYS));

/**
 * 템플릿의 날짜 범위를 [시작일, 종료일] (양끝 포함, 현지 달력 기준)로 반환한다.
 * 예) monthly, 오늘이 2026-07-14 이면 ['2026-06-15', '2026-07-14'] = 정확히 30일
 */
export function getReportTemplateRange(
  template: ReportTemplate,
  today: Date = new Date()
): [string, string] {
  const days = REPORT_TEMPLATE_DAYS[template];
  return [format(subDays(today, days - 1), 'yyyy-MM-dd'), format(today, 'yyyy-MM-dd')];
}
