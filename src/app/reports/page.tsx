'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Typography, message } from 'antd';
import { format, subDays } from 'date-fns';
import { ReportDashboard } from '@/components/reports';
import { useReportsTranslation } from '@/hooks/useTranslation';
import { useRealtimeProductionRecords } from '@/hooks/useRealtimeProductionRecords';
import { fetchMachines } from '@/lib/machinesCache';
import { Machine } from '@/types';

const { Title } = Typography;

// 빠른 보고서 템플릿 중 가장 긴 기간이 "월간(최근 30일)"이므로 기본 조회 기간을 30일로 맞춘다.
const DEFAULT_REPORT_WINDOW_DAYS = 30;
// 설비 800대 × 2교대 × 30일 ≈ 48,000행 → 50,000행 상한이면 기본 기간이 잘리지 않는다.
const REPORT_RECORD_LIMIT = 50000;

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
    limit: REPORT_RECORD_LIMIT
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
        message.error('설비 데이터를 불러오는데 실패했습니다');
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
