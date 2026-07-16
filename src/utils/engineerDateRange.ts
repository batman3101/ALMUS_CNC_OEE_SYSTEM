import { format, subDays } from 'date-fns';

export type EngineerRangeDays = 7 | 30 | 90;

/** 오늘을 포함해 정확히 days개의 로컬 달력 날짜를 반환한다. */
export const getInclusiveDateRange = (
  days: EngineerRangeDays,
  today: Date = new Date()
): { start_date: string; end_date: string } => ({
  start_date: format(subDays(today, days - 1), 'yyyy-MM-dd'),
  end_date: format(today, 'yyyy-MM-dd')
});
