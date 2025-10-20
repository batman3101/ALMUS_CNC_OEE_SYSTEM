import { Chart } from 'chart.js';

export interface ChartConfig {
  type: 'bar' | 'line' | 'pie' | 'doughnut';
  data: any;
  options?: any;
}

export class ReportUtils {
  /**
   * 차트를 이미지로 변환
   */
  static async chartToImage(chartRef: Chart | null): Promise<string | null> {
    if (!chartRef || !chartRef.canvas) {
      return null;
    }

    return new Promise((resolve) => {
      const canvas = chartRef.canvas;
      const imgData = canvas.toDataURL('image/png', 1.0);
      resolve(imgData);
    });
  }

  /**
   * HTML 요소를 이미지로 변환
   */
  static async elementToImage(element: HTMLElement): Promise<string> {
    // html2canvas 라이브러리가 필요하지만, 여기서는 기본 구현만 제공
    return new Promise((resolve) => {
      // 실제 구현에서는 html2canvas를 사용
      resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
    });
  }

  /**
   * 데이터를 CSV 형식으로 변환
   */
  static arrayToCSV(data: any[][]): string {
    return data.map(row => 
      row.map(cell => 
        typeof cell === 'string' && cell.includes(',') 
          ? `"${cell}"` 
          : cell
      ).join(',')
    ).join('\n');
  }

  /**
   * 파일 다운로드 헬퍼
   */
  static downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 날짜 범위 생성
   */
  static generateDateRange(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    while (start <= end) {
      dates.push(start.toISOString().split('T')[0]);
      start.setDate(start.getDate() + 1);
    }

    return dates;
  }

  /**
   * OEE 색상 코드 반환
   */
  static getOEEColor(oee: number): string {
    if (oee >= 0.85) return '#52c41a'; // 녹색 (우수)
    if (oee >= 0.65) return '#faad14'; // 주황색 (보통)
    return '#ff4d4f'; // 빨간색 (개선 필요)
  }

  /**
   * 설비 상태별 색상 반환
   */
  static getStateColor(state: string): string {
    const colors: Record<string, string> = {
      'NORMAL_OPERATION': '#52c41a',
      'MAINTENANCE': '#faad14',
      'MODEL_CHANGE': '#1890ff',
      'PLANNED_STOP': '#722ed1',
      'PROGRAM_CHANGE': '#13c2c2',
      'TOOL_CHANGE': '#eb2f96',
      'TEMPORARY_STOP': '#ff4d4f'
    };
    return colors[state] || '#d9d9d9';
  }

  /**
   * 숫자 포맷팅
   */
  static formatNumber(num: number, decimals: number = 1): string {
    return num.toLocaleString('ko-KR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /**
   * 퍼센트 포맷팅
   */
  static formatPercent(num: number, decimals: number = 1): string {
    return `${(num * 100).toFixed(decimals)}%`;
  }

  /**
   * 시간 포맷팅 (분 -> 시:분)
   */
  static formatMinutes(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours}:${mins.toString().padStart(2, '0')}`;
  }
}