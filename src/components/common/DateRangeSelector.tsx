'use client';

import React, { useState } from 'react';
import { Select, DatePicker, Space } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import { useDateRange, DateRangePreset } from '@/contexts/DateRangeContext';
import { useDashboardTranslation } from '@/hooks/useTranslation';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

interface DateRangeSelectorProps {
  style?: React.CSSProperties;
  className?: string;
}

export const DateRangeSelector: React.FC<DateRangeSelectorProps> = ({
  style,
  className
}) => {
  const { t } = useDashboardTranslation();
  const { preset, dateRange, handlePresetChange } = useDateRange();
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  const presetOptions = [
    { label: t('filters.today'), value: 'today' },
    { label: t('filters.last7Days'), value: 'last7days' },
    { label: t('filters.last30Days'), value: 'last30days' },
    { label: t('filters.customRange'), value: 'custom' }
  ];

  /**
   * Preset 선택 변경 핸들러
   */
  const handleSelectChange = (value: DateRangePreset) => {
    if (value === 'custom') {
      setShowCustomPicker(true);
      // custom 선택 시에는 현재 dateRange 유지
      handlePresetChange(value);
    } else {
      setShowCustomPicker(false);
      handlePresetChange(value);
    }
  };

  /**
   * 날짜 범위 선택기 변경 핸들러
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleRangeChange = (
    dates: [Dayjs | null, Dayjs | null] | null
  ) => {
    if (dates && dates[0] && dates[1]) {
      handlePresetChange('custom', {
        startDate: dates[0].toDate(),
        endDate: dates[1].toDate()
      });
    }
  };

  /**
   * 현재 날짜 범위를 Dayjs로 변환
   */
  const currentRange: [Dayjs, Dayjs] = [
    dayjs(dateRange.startDate),
    dayjs(dateRange.endDate)
  ];

  return (
    <Space size="middle" style={style} className={className}>
      <Select
        value={preset}
        onChange={handleSelectChange}
        options={presetOptions}
        style={{ width: 140 }}
        suffixIcon={<CalendarOutlined />}
      />

      {showCustomPicker && preset === 'custom' && (
        <RangePicker
          value={currentRange}
          onChange={handleRangeChange}
          format="YYYY-MM-DD"
          placeholder={[t('time.startDate'), t('time.endDate')]}
          allowClear={false}
        />
      )}
    </Space>
  );
};
