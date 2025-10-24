'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { startOfDay, endOfDay, subDays, format } from 'date-fns';

export type DateRangePreset = 'today' | 'last7days' | 'last30days' | 'custom';

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

interface DateRangeContextType {
  // 현재 선택된 preset
  preset: DateRangePreset;
  setPreset: (preset: DateRangePreset) => void;

  // 현재 날짜 범위
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;

  // 날짜 범위 문자열 (API 호출용)
  getFormattedRange: () => { startDate: string; endDate: string };

  // Preset 변경 시 자동으로 날짜 범위 계산
  handlePresetChange: (preset: DateRangePreset, customRange?: DateRange) => void;
}

const DateRangeContext = createContext<DateRangeContextType | undefined>(undefined);

interface DateRangeProviderProps {
  children: ReactNode;
}

export function DateRangeProvider({ children }: DateRangeProviderProps) {
  const [preset, setPreset] = useState<DateRangePreset>('today');
  const [dateRange, setDateRange] = useState<DateRange>({
    startDate: startOfDay(new Date()),
    endDate: endOfDay(new Date())
  });

  /**
   * Preset에 따른 날짜 범위 계산
   */
  const calculateDateRangeFromPreset = useCallback((presetType: DateRangePreset): DateRange => {
    const today = new Date();

    switch (presetType) {
      case 'today':
        return {
          startDate: startOfDay(today),
          endDate: endOfDay(today)
        };

      case 'last7days':
        return {
          startDate: startOfDay(subDays(today, 6)), // 오늘 포함 7일
          endDate: endOfDay(today)
        };

      case 'last30days':
        return {
          startDate: startOfDay(subDays(today, 29)), // 오늘 포함 30일
          endDate: endOfDay(today)
        };

      case 'custom':
        // custom은 handlePresetChange에서 별도 처리
        return {
          startDate: startOfDay(today),
          endDate: endOfDay(today)
        };

      default:
        return {
          startDate: startOfDay(today),
          endDate: endOfDay(today)
        };
    }
  }, []);

  /**
   * Preset 변경 핸들러
   */
  const handlePresetChange = useCallback((newPreset: DateRangePreset, customRange?: DateRange) => {
    setPreset(newPreset);

    if (newPreset === 'custom' && customRange) {
      setDateRange(customRange);
    } else {
      const newRange = calculateDateRangeFromPreset(newPreset);
      setDateRange(newRange);
    }
  }, [calculateDateRangeFromPreset]);

  /**
   * API 호출용 포맷된 날짜 범위 반환
   */
  const getFormattedRange = useCallback(() => {
    return {
      startDate: format(dateRange.startDate, 'yyyy-MM-dd'),
      endDate: format(dateRange.endDate, 'yyyy-MM-dd')
    };
  }, [dateRange]);

  const value: DateRangeContextType = useMemo(() => ({
    preset,
    setPreset,
    dateRange,
    setDateRange,
    getFormattedRange,
    handlePresetChange
  }), [preset, dateRange, getFormattedRange, handlePresetChange]);

  return (
    <DateRangeContext.Provider value={value}>
      {children}
    </DateRangeContext.Provider>
  );
}

/**
 * DateRange Context Hook
 */
export function useDateRange() {
  const context = useContext(DateRangeContext);

  if (context === undefined) {
    throw new Error('useDateRange must be used within a DateRangeProvider');
  }

  return context;
}
