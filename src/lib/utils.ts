import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatNumber(value: number, decimals: number = 0): string {
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function getShiftFromTime(date: Date): 'A' | 'B' {
  const hours = date.getHours();
  // A조: 08:00 - 20:00
  // B조: 20:00 - 08:00
  return hours >= 8 && hours < 20 ? 'A' : 'B';
}

export function getProductionDateRange(date: Date): { start: Date; end: Date } {
  // 생산일 기준: 08:00 - 다음날 07:59
  const start = new Date(date);
  start.setHours(8, 0, 0, 0);
  
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setHours(7, 59, 59, 999);
  
  return { start, end };
}

export function getMachineStateColor(state: string): string {
  const colors: Record<string, string> = {
    running: 'bg-green-500',
    maintenance: 'bg-red-500',
    model_change: 'bg-yellow-500',
    planned_stop: 'bg-gray-500',
    program_change: 'bg-orange-500',
    tool_change: 'bg-amber-500',
    pause: 'bg-blue-500',
  };
  return colors[state] || 'bg-gray-400';
}

export function getMachineStateTextColor(state: string): string {
  const colors: Record<string, string> = {
    running: 'text-green-600',
    maintenance: 'text-red-600',
    model_change: 'text-yellow-600',
    planned_stop: 'text-gray-600',
    program_change: 'text-orange-600',
    tool_change: 'text-amber-600',
    pause: 'text-blue-600',
  };
  return colors[state] || 'text-gray-600';
}