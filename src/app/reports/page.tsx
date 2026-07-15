'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Typography, message } from 'antd';
import { format, subDays } from 'date-fns';
import { ReportDashboard } from '@/components/reports';
import { useReportsTranslation } from '@/hooks/useTranslation';
import { useRealtimeProductionRecords } from '@/hooks/useRealtimeProductionRecords';
import { fetchMachines } from '@/lib/machinesCache';
import { MAX_REPORT_TEMPLATE_DAYS } from '@/utils/reportRange';
import { Machine } from '@/types';

const { Title } = Typography;

// 조회 기간은 빠른 보고서 템플릿 중 가장 긴 것(월간=30일)과 반드시 같거나 길어야 한다.
// 상수를 공유해, 템플릿 기간만 늘리고 조회 기간을 안 늘려서 앞쪽 날짜가 조용히 비는 일을 막는다.
const DEFAULT_REPORT_WINDOW_DAYS = MAX_REPORT_TEMPLATE_DAYS;
export default function ReportsPage() {
  const { t } = useReportsTranslation();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  // 보고서 기간 필터 (ReportDashboard의 RangePicker가 갱신) — 조회/필터링의 단일 기준
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);

  // 선택된 기간이 없으면 최근 30일을 조회한다 (전체 테이블 조회 금지)
  const recordsFilter = useMemo(() => {
    const today = new Date();
    return {
      dateRange: {
        start: dateRange ? dateRange[0] : format(subDays(today, DEFAULT_REPORT_WINDOW_DAYS - 1), 'yyyy-MM-dd'),
        end: dateRange ? dateRange[1] : format(today, 'yyyy-MM-dd')
      }
    };
  }, [dateRange]);

  // 실시간 생산 기록 데이터 구독 (보고서 데이터의 단일 소스)
  const {
    records: productionRecords,
    loading: recordsLoading,
    aggregatedData,
    refreshRecords
  } = useRealtimeProductionRecords({
    filters: recordsFilter,
    // 보고서 미리보기와 Excel/PDF 원본은 통계 카드와 같은 전체 범위를 사용해야 한다.
    // API의 안정 정렬 페이지를 끝까지 따라가므로 1,000/50,000행 경계에서 잘리지 않는다.
    fetchAll: true
  });

  // 실제 설비 데이터 가져오기 (공용 캐시로 중복 호출 제거)
  useEffect(() => {
    const loadMachines = async () => {
      try {
        setLoading(true);
        const data = await fetchMachines();
        setMachines(data);
      } catch (error) {
        console.error('Error fetching machines:', error);
        message.error(t('errors.fetchMachinesFailed'));
      } finally {
        setLoading(false);
      }
    };

    loadMachines();
  }, []);

  return (
    <div>
      {/* 페이지 제목 */}
      <div style={{ marginBottom: '24px' }}>
        <Title level={2}>
          {t('title')}
        </Title>
        <Typography.Paragraph type="secondary">
          {t('description')}
        </Typography.Paragraph>
      </div>

      {/* 보고서 대시보드 */}
      <ReportDashboard
        machines={machines}
        loading={loading || recordsLoading}
        productionRecords={productionRecords}
        aggregatedData={aggregatedData()}
        onRefreshRecords={refreshRecords}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />
    </div>
  );
}
