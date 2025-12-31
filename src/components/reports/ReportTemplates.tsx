'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { OEEMetrics, Machine, ProductionRecord } from '@/types';
import { addKoreanText } from '@/lib/fonts';

interface ReportData {
  machines: Machine[];
  oeeData: OEEMetrics[];
  productionData: ProductionRecord[];
  reportType: 'summary' | 'detailed' | 'trend' | 'downtime';
  dateRange: [string, string];
  selectedMachines: string[];
  includeCharts: boolean;
  includeOEE: boolean;
  includeProduction: boolean;
  includeDowntime: boolean;
  groupBy: 'machine' | 'date' | 'shift';
}

interface ChartData {
  chartElement?: HTMLCanvasElement;
  chartImage?: string;
  title: string;
  type: 'oee-gauge' | 'trend' | 'downtime' | 'production';
}

export class ReportTemplates {
  // 한국어 텍스트 표시 유틸리티
  static async addKoreanTextToPDF(doc: jsPDF, text: string, x: number, y: number, options: Record<string, unknown> = {}): Promise<void> {
    addKoreanText(doc, text, x, y, options);
  }

  // 차트를 이미지로 캡처하는 헬퍼 함수
  static async captureChartAsImage(chartElement: HTMLCanvasElement): Promise<string> {
    return new Promise((resolve) => {
      const imgData = chartElement.toDataURL('image/png', 1.0);
      resolve(imgData);
    });
  }

  // DOM 요소를 이미지로 캡처하는 헬퍼 함수
  static async captureElementAsImage(element: HTMLElement): Promise<string> {
    try {
      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true
      });
      return canvas.toDataURL('image/png', 1.0);
    } catch (error) {
      console.error('차트 캡처 실패:', error);
      return '';
    }
  }



  static async generatePDFReport(data: ReportData, charts?: ChartData[]): Promise<void> {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let yPosition = 20;

    // === 표지 페이지 ===
    // 제목
    doc.setFontSize(24);
    doc.text('CNC OEE Monitoring Report', pageWidth / 2, 55, { align: 'center' });
    
    // 한국어 제목 (이미지로 추가)
    await this.addKoreanTextToPDF(doc, 'CNC OEE 모니터링 보고서', pageWidth / 2, 70, { 
      align: 'center', 
      fontSize: 18 
    });

    // 보고서 정보 박스
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.rect(30, 100, pageWidth - 60, 80);
    
    doc.setFontSize(12);
    const reportTypeMap = {
      summary: '요약 보고서',
      detailed: '상세 보고서', 
      trend: '추이 분석',
      downtime: '다운타임 분석'
    };
    
    // 보고서 정보
    doc.setFontSize(12);
    doc.text('Report Type:', 40, 120);
    await this.addKoreanTextToPDF(doc, `보고서 유형: ${reportTypeMap[data.reportType]}`, 120, 120);
    
    doc.text('Period:', 40, 135);
    await this.addKoreanTextToPDF(doc, `기간: ${data.dateRange[0]} ~ ${data.dateRange[1]}`, 80, 135);
    
    doc.text('Machines:', 40, 150);
    await this.addKoreanTextToPDF(doc, `대상 설비: ${data.machines.length}대`, 90, 150);
    
    doc.text('Generated:', 40, 165);
    await this.addKoreanTextToPDF(doc, `생성일시: ${new Date().toLocaleString('ko-KR')}`, 95, 165);

    // 새 페이지 시작
    doc.addPage();
    yPosition = 20;

    // === 목차 ===
    doc.setFontSize(18);
    doc.text('Table of Contents', 20, yPosition);
    await this.addKoreanTextToPDF(doc, '목차', 20, yPosition + 15, { fontSize: 14 });
    yPosition += 25;

    doc.setFontSize(12);
    const tocItems = [
      { eng: '1. Equipment Status', kor: '1. 설비 현황' },
      { eng: '2. OEE Metrics Summary', kor: '2. OEE 지표 요약' },
      { eng: '3. Production Summary', kor: '3. 생산 실적 요약' },
      { eng: '4. Chart Analysis', kor: '4. 차트 분석' },
      { eng: '5. Detailed Data', kor: '5. 상세 데이터' }
    ];

    for (const item of tocItems) {
      doc.text(item.eng, 30, yPosition);
      await this.addKoreanTextToPDF(doc, item.kor, 30, yPosition + 8, { fontSize: 10 });
      yPosition += 16;
    }

    // === 설비 현황 ===
    doc.addPage();
    yPosition = 20;
    
    doc.setFontSize(16);
    doc.text('1. Equipment Status', 20, yPosition);
    await this.addKoreanTextToPDF(doc, '1. 설비 현황', 20, yPosition + 15, { fontSize: 14 });
    yPosition += 25;

    if (data.machines.length > 0) {
      // autoTable을 이용한 세밀한 설정으로 한국어 지원 개선
      const tableData = data.machines.map((machine, index) => ([
        (index + 1).toString(),
        machine.name || '-',
        machine.location || '-', 
        machine.equipment_type || '-',
        machine.current_tact_time ? machine.current_tact_time.toString() : '-',
        machine.is_active ? 'Active' : 'Inactive'
      ]));

      autoTable(doc, {
        head: [['No.', 'Machine', 'Location', 'Model', 'Tact Time', 'Status']],
        body: tableData,
        startY: yPosition,
        margin: { left: 20, right: 20 },
        styles: {
          fontSize: 9,
          cellPadding: 3,
          halign: 'center',
          font: 'helvetica'
        },
        headStyles: {
          fillColor: [230, 230, 230],
          textColor: [0, 0, 0],
          fontSize: 10,
          fontStyle: 'bold',
          font: 'helvetica'
        },
        alternateRowStyles: {
          fillColor: [248, 248, 248]
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 15 },
          1: { halign: 'left', cellWidth: 35 },
          2: { halign: 'left', cellWidth: 25 },
          3: { halign: 'left', cellWidth: 25 },
          4: { halign: 'center', cellWidth: 20 },
          5: { halign: 'center', cellWidth: 20 }
        }
      });
      
      yPosition = ((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
    }

    // === OEE 지표 요약 ===
    if (data.includeOEE && data.oeeData.length > 0) {
      if (yPosition > pageHeight - 100) {
        doc.addPage();
        yPosition = 20;
      }

      doc.setFontSize(16);
      doc.text('2. OEE Metrics Summary', 20, yPosition);
      await this.addKoreanTextToPDF(doc, '2. OEE 지표 요약', 20, yPosition + 15, { fontSize: 14 });
      yPosition += 25;

      // OEE 통계 계산
      const avgOEE = data.oeeData.reduce((sum, oee) => sum + oee.oee, 0) / data.oeeData.length;
      const avgAvailability = data.oeeData.reduce((sum, oee) => sum + oee.availability, 0) / data.oeeData.length;
      const avgPerformance = data.oeeData.reduce((sum, oee) => sum + oee.performance, 0) / data.oeeData.length;
      const avgQuality = data.oeeData.reduce((sum, oee) => sum + oee.quality, 0) / data.oeeData.length;
      const maxOEE = Math.max(...data.oeeData.map(oee => oee.oee));
      const minOEE = Math.min(...data.oeeData.map(oee => oee.oee));

      // OEE 요약 박스
      doc.setDrawColor(0, 0, 0);
      doc.setFillColor(245, 245, 245);
      doc.rect(20, yPosition, pageWidth - 40, 50, 'FD');
      
      doc.setFontSize(12);
      doc.text(`Average OEE: ${(avgOEE * 100).toFixed(1)}%`, 30, yPosition + 15);
      doc.text(`Average Availability: ${(avgAvailability * 100).toFixed(1)}%`, 30, yPosition + 25);
      doc.text(`Average Performance: ${(avgPerformance * 100).toFixed(1)}%`, 30, yPosition + 35);
      doc.text(`Average Quality: ${(avgQuality * 100).toFixed(1)}%`, 30, yPosition + 45);
      
      doc.text(`Max OEE: ${(maxOEE * 100).toFixed(1)}%`, pageWidth / 2 + 10, yPosition + 15);
      doc.text(`Min OEE: ${(minOEE * 100).toFixed(1)}%`, pageWidth / 2 + 10, yPosition + 25);
      doc.text(`Excellent Ratio: ${((data.oeeData.filter(oee => oee.oee >= 0.85).length / data.oeeData.length) * 100).toFixed(1)}%`, pageWidth / 2 + 10, yPosition + 35);
      
      yPosition += 60;
    }

    // === Production Summary ===
    if (data.includeProduction && data.productionData.length > 0) {
      if (yPosition > pageHeight - 80) {
        doc.addPage();
        yPosition = 20;
      }

      doc.setFontSize(16);
      doc.text('3. Production Summary', 20, yPosition);
      await this.addKoreanTextToPDF(doc, '3. 생산 실적 요약', 20, yPosition + 15, { fontSize: 14 });
      yPosition += 25;

      const totalOutput = data.productionData.reduce((sum, prod) => sum + prod.output_qty, 0);
      const totalDefects = data.productionData.reduce((sum, prod) => sum + prod.defect_qty, 0);
      const defectRate = totalOutput > 0 ? (totalDefects / totalOutput * 100) : 0;
      const goodQty = totalOutput - totalDefects;

      // 생산 실적 박스
      doc.setDrawColor(0, 0, 0);
      doc.setFillColor(245, 245, 245);
      doc.rect(20, yPosition, pageWidth - 40, 40, 'FD');
      
      doc.setFontSize(12);
      doc.text(`Total Output: ${totalOutput.toLocaleString()} pcs`, 30, yPosition + 15);
      doc.text(`Good Quantity: ${goodQty.toLocaleString()} pcs`, 30, yPosition + 25);
      doc.text(`Defect Quantity: ${totalDefects.toLocaleString()} pcs`, pageWidth / 2 + 10, yPosition + 15);
      doc.text(`Defect Rate: ${defectRate.toFixed(2)}%`, pageWidth / 2 + 10, yPosition + 25);
      
      yPosition += 50;
    }

    // === 차트 분석 ===
    doc.addPage();
    yPosition = 20;
    
    doc.setFontSize(16);
    doc.text('4. Chart Analysis', 20, yPosition);
    await this.addKoreanTextToPDF(doc, '4. 차트 분석', 20, yPosition + 15, { fontSize: 14 });
    yPosition += 25;

    if (data.includeCharts && charts && charts.length > 0) {
      for (const chart of charts) {
        if (chart.chartImage) {
          if (yPosition > pageHeight - 120) {
            doc.addPage();
            yPosition = 20;
          }

          doc.setFontSize(12);
          doc.text(chart.title, 20, yPosition);
          yPosition += 10;

          try {
            doc.addImage(chart.chartImage, 'PNG', 20, yPosition, pageWidth - 40, 80);
            yPosition += 90;
          } catch (error) {
            console.error('차트 이미지 추가 실패:', error);
            doc.text('차트를 표시할 수 없습니다.', 20, yPosition);
            yPosition += 20;
          }
        }
      }
    } else {
      // 차트가 없는 경우 메시지 표시
      doc.setFontSize(12);
      doc.text('Charts are not available in this report.', 20, yPosition);
      await this.addKoreanTextToPDF(doc, '이 보고서에는 차트가 포함되지 않았습니다.', 20, yPosition + 15, { fontSize: 11 });
      
      doc.text('To include charts in your report:', 20, yPosition + 30);
      await this.addKoreanTextToPDF(doc, '차트를 포함하려면:', 20, yPosition + 45, { fontSize: 11 });
      
      doc.text('1. Visit the Dashboard page', 25, yPosition + 60);
      await this.addKoreanTextToPDF(doc, '1. 대시보드 페이지를 방문하세요', 25, yPosition + 75, { fontSize: 10 });
      
      doc.text('2. Generate OEE charts and metrics', 25, yPosition + 90);
      await this.addKoreanTextToPDF(doc, '2. OEE 차트와 지표를 생성하세요', 25, yPosition + 105, { fontSize: 10 });
      
      doc.text('3. Return to Reports page and regenerate', 25, yPosition + 120);
      await this.addKoreanTextToPDF(doc, '3. 리포트 페이지로 돌아와 다시 생성하세요', 25, yPosition + 135, { fontSize: 10 });
      
      yPosition += 155;
    }

    // === 상세 데이터 ===
    doc.addPage();
    yPosition = 20;
    
    doc.setFontSize(16);
    doc.text('5. Detailed Data', 20, yPosition);
    await this.addKoreanTextToPDF(doc, '5. 상세 데이터', 20, yPosition + 15, { fontSize: 14 });
    yPosition += 25;

    // 설비별 상세 OEE 데이터 표시
    if (data.oeeData.length > 0 && data.machines.length > 0) {
      doc.setFontSize(14);
      doc.text('Detailed OEE Data by Machine', 20, yPosition);
      yPosition += 15;

      // 간단한 상세 데이터 테이블
      const detailData = data.machines.slice(0, 10).map((machine, index) => {
        // 해당 설비의 평균 OEE 계산 (실제 데이터가 있다면 필터링)
        const avgOEE = data.oeeData.length > 0 ? 
          ((data.oeeData.reduce((sum, oee) => sum + oee.oee, 0) / data.oeeData.length) * 100).toFixed(1) : '0.0';
        
        return [
          (index + 1).toString(),
          machine.name || '-',
          machine.location || '-',
          `${avgOEE}%`,
          machine.is_active ? 'Active' : 'Inactive'
        ];
      });

      autoTable(doc, {
        head: [['No.', 'Machine', 'Location', 'Avg OEE', 'Status']],
        body: detailData,
        startY: yPosition,
        margin: { left: 20, right: 20 },
        styles: {
          fontSize: 9,
          cellPadding: 3,
          halign: 'center',
          font: 'helvetica'
        },
        headStyles: {
          fillColor: [220, 220, 220],
          textColor: [0, 0, 0],
          fontSize: 10,
          fontStyle: 'bold'
        },
        alternateRowStyles: {
          fillColor: [248, 248, 248]
        }
      });
      
      yPosition = ((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
    } else {
      doc.setFontSize(12);
      doc.text('No detailed data available.', 20, yPosition);
      doc.text('Please register production records from the data input page.', 20, yPosition + 15);
      yPosition += 40;
    }

    // 생산 실적 상세 (최근 10건)
    if (data.productionData.length > 0) {
      if (yPosition > pageHeight - 100) {
        doc.addPage();
        yPosition = 20;
      }
      
      doc.setFontSize(14);
      doc.text('Recent Production Records (Max 10 items)', 20, yPosition);
      yPosition += 15;

      const recentProduction = data.productionData.slice(0, 10).map((record, index) => [
        (index + 1).toString(),
        record.date || '-',
        record.shift || '-',
        record.output_qty?.toString() || '0',
        record.defect_qty?.toString() || '0',
        record.oee ? `${(record.oee * 100).toFixed(1)}%` : '0.0%'
      ]);

      autoTable(doc, {
        head: [['No.', 'Date', 'Shift', 'Output', 'Defects', 'OEE']],
        body: recentProduction,
        startY: yPosition,
        margin: { left: 20, right: 20 },
        styles: {
          fontSize: 8,
          cellPadding: 2,
          halign: 'center',
          font: 'helvetica'
        },
        headStyles: {
          fillColor: [220, 220, 220],
          textColor: [0, 0, 0],
          fontSize: 9,
          fontStyle: 'bold'
        },
        alternateRowStyles: {
          fillColor: [248, 248, 248]
        }
      });
      
      yPosition = ((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    }

      // 파일 저장
      const fileName = `OEE_Report_${data.reportType}_${data.dateRange[0]}_${data.dateRange[1]}.pdf`;
      doc.save(fileName);
    } catch (error: unknown) {
      console.error('PDF 보고서 생성 중 오류:', error);
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      throw new Error(`PDF 보고서 생성 실패: ${errorMessage}`);
    }
  }

  // 레거시 테이블 그리기 함수 (autoTable로 대체됨)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static drawTable(_doc: jsPDF, _data: string[][], _x: number, _y: number, _width: number) {
    // autoTable 사용으로 대체됨 - 호환성을 위해 유지
    console.warn('drawTable은 deprecated됨. autoTable 사용 권장');
  }

  static async generateExcelReport(data: ReportData): Promise<void> {
    try {
      const workbook = XLSX.utils.book_new();

    // === 요약 시트 ===
    const summaryData = [
      ['CNC OEE 모니터링 보고서'],
      ['CNC OEE Monitoring Report'],
      [''],
      ['보고서 정보', 'Report Information'],
      ['보고서 유형', data.reportType === 'summary' ? '요약 보고서' : 
       data.reportType === 'detailed' ? '상세 보고서' :
       data.reportType === 'trend' ? '추이 분석' : '다운타임 분석'],
      ['기간', `${data.dateRange[0]} ~ ${data.dateRange[1]}`],
      ['생성일시', new Date().toLocaleString('ko-KR')],
      ['대상 설비 수', data.machines.length],
      ['']
    ];

    // OEE 요약 통계
    if (data.includeOEE && data.oeeData.length > 0) {
      const avgOEE = data.oeeData.reduce((sum, oee) => sum + oee.oee, 0) / data.oeeData.length;
      const avgAvailability = data.oeeData.reduce((sum, oee) => sum + oee.availability, 0) / data.oeeData.length;
      const avgPerformance = data.oeeData.reduce((sum, oee) => sum + oee.performance, 0) / data.oeeData.length;
      const avgQuality = data.oeeData.reduce((sum, oee) => sum + oee.quality, 0) / data.oeeData.length;
      const maxOEE = Math.max(...data.oeeData.map(oee => oee.oee));
      const minOEE = Math.min(...data.oeeData.map(oee => oee.oee));
      const excellentCount = data.oeeData.filter(oee => oee.oee >= 0.85).length;

      summaryData.push(
        ['OEE 지표 요약', 'OEE Metrics Summary'],
        ['평균 OEE', `${(avgOEE * 100).toFixed(1)}%`],
        ['평균 가동률', `${(avgAvailability * 100).toFixed(1)}%`],
        ['평균 성능', `${(avgPerformance * 100).toFixed(1)}%`],
        ['평균 품질', `${(avgQuality * 100).toFixed(1)}%`],
        ['최고 OEE', `${(maxOEE * 100).toFixed(1)}%`],
        ['최저 OEE', `${(minOEE * 100).toFixed(1)}%`],
        ['우수 등급 비율', `${(excellentCount / data.oeeData.length * 100).toFixed(1)}%`],
        ['']
      );
    }

    // 생산 실적 요약
    if (data.includeProduction && data.productionData.length > 0) {
      const totalOutput = data.productionData.reduce((sum, prod) => sum + prod.output_qty, 0);
      const totalDefects = data.productionData.reduce((sum, prod) => sum + prod.defect_qty, 0);
      const defectRate = totalOutput > 0 ? (totalDefects / totalOutput * 100) : 0;
      const goodQty = totalOutput - totalDefects;

      summaryData.push(
        ['생산 실적 요약', 'Production Summary'],
        ['총 생산량', totalOutput],
        ['양품 수량', goodQty],
        ['불량 수량', totalDefects],
        ['불량률', `${defectRate.toFixed(2)}%`],
        ['']
      );
    }

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    
    // 요약 시트 스타일링
    summarySheet['!cols'] = [{ width: 20 }, { width: 25 }];
    summarySheet['A1'].s = { font: { bold: true, sz: 16 }, alignment: { horizontal: 'center' } };
    summarySheet['A2'].s = { font: { bold: true, sz: 14 }, alignment: { horizontal: 'center' } };
    
    XLSX.utils.book_append_sheet(workbook, summarySheet, '요약');

    // === 설비 목록 시트 ===
    if (data.machines.length > 0) {
      const machineHeaders = ['설비ID', '설비명', '위치', '모델', 'Tact Time(초)', '상태', '등록일'];
      const machineData = [
        machineHeaders,
        ...data.machines.map(machine => [
          machine.id,
          machine.name || '-',
          machine.location || '-',
          machine.equipment_type || '-',
          machine.current_tact_time || '-',
          machine.is_active ? 'Active' : 'Inactive',
          machine.created_at ? new Date(machine.created_at).toLocaleDateString('ko-KR') : '-'
        ])
      ];

      const machineSheet = XLSX.utils.aoa_to_sheet(machineData);
      
      // 설비 시트 스타일링
      machineSheet['!cols'] = [
        { width: 15 }, { width: 20 }, { width: 15 }, 
        { width: 15 }, { width: 12 }, { width: 10 }, { width: 12 }
      ];
      
      XLSX.utils.book_append_sheet(workbook, machineSheet, '설비목록');
    }

    // === OEE 데이터 시트 ===
    if (data.includeOEE && data.oeeData.length > 0) {
      const oeeHeaders = [
        '가동률(%)', '성능(%)', '품질(%)', 'OEE(%)', 
        '실제가동시간(분)', '계획가동시간(분)', '이상가동시간(분)',
        '생산수량', '불량수량', '양품수량'
      ];
      
      const oeeDataArray = [
        oeeHeaders,
        ...data.oeeData.map((oee) => [
          (oee.availability * 100).toFixed(1),
          (oee.performance * 100).toFixed(1),
          (oee.quality * 100).toFixed(1),
          (oee.oee * 100).toFixed(1),
          oee.actual_runtime,
          oee.planned_runtime,
          oee.ideal_runtime || 0,
          oee.output_qty,
          oee.defect_qty,
          oee.output_qty - oee.defect_qty
        ])
      ];

      const oeeSheet = XLSX.utils.aoa_to_sheet(oeeDataArray);
      
      // OEE 시트 스타일링
      oeeSheet['!cols'] = Array(10).fill({ width: 12 });
      
      XLSX.utils.book_append_sheet(workbook, oeeSheet, 'OEE데이터');
    }

    // === 생산 실적 시트 ===
    if (data.includeProduction && data.productionData.length > 0) {
      const productionHeaders = [
        '날짜', '교대', '설비ID', '계획가동시간(분)', '실제가동시간(분)', 
        '생산수량', '불량수량', '양품수량', '불량률(%)', 
        '가동률(%)', '성능(%)', '품질(%)', 'OEE(%)'
      ];
      
      const productionDataArray = [
        productionHeaders,
        ...data.productionData.map(prod => [
          prod.date,
          prod.shift || '-',
          prod.machine_id,
          prod.planned_runtime || 0,
          prod.actual_runtime || 0,
          prod.output_qty,
          prod.defect_qty,
          prod.output_qty - prod.defect_qty,
          prod.output_qty > 0 ? ((prod.defect_qty / prod.output_qty) * 100).toFixed(2) : '0.00',
          prod.availability ? (prod.availability * 100).toFixed(1) : '-',
          prod.performance ? (prod.performance * 100).toFixed(1) : '-',
          prod.quality ? (prod.quality * 100).toFixed(1) : '-',
          prod.oee ? (prod.oee * 100).toFixed(1) : '-'
        ])
      ];

      const productionSheet = XLSX.utils.aoa_to_sheet(productionDataArray);
      
      // 생산 실적 시트 스타일링
      productionSheet['!cols'] = Array(13).fill({ width: 12 });
      
      XLSX.utils.book_append_sheet(workbook, productionSheet, '생산실적');
    }

    // === 분석 시트 (그룹별 집계) ===
    if (data.groupBy && (data.includeOEE || data.includeProduction)) {
      const analysisData = this.generateAnalysisData(data);
      if (analysisData.length > 0) {
        const analysisSheet = XLSX.utils.aoa_to_sheet(analysisData);
        analysisSheet['!cols'] = Array(analysisData[0].length).fill({ width: 15 });
        XLSX.utils.book_append_sheet(workbook, analysisSheet, '분석');
      }
    }

      // 파일 저장
      const fileName = `OEE_Report_${data.reportType}_${data.dateRange[0]}_${data.dateRange[1]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
    } catch (error: unknown) {
      console.error('Excel 보고서 생성 중 오류:', error);
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      throw new Error(`Excel 보고서 생성 실패: ${errorMessage}`);
    }
  }

  // 분석 데이터 생성 헬퍼 함수
  static generateAnalysisData(data: ReportData): (string | number)[][] {
    const analysisData: (string | number)[][] = [];

    if (data.groupBy === 'machine' && data.machines.length > 0) {
      analysisData.push(['설비별 분석', 'Machine Analysis']);
      analysisData.push(['설비명', '평균 OEE(%)', '평균 가동률(%)', '총 생산량', '불량률(%)']);

      data.machines.forEach(machine => {
        const machineOEE = data.oeeData.filter(() =>
          data.productionData.some(prod => prod.machine_id === machine.id)
        );
        const machineProduction = data.productionData.filter(prod => prod.machine_id === machine.id);

        if (machineOEE.length > 0 || machineProduction.length > 0) {
          const avgOEE = machineOEE.length > 0 ?
            (machineOEE.reduce((sum, oee) => sum + oee.oee, 0) / machineOEE.length * 100).toFixed(1) : '-';
          const avgAvailability = machineOEE.length > 0 ?
            (machineOEE.reduce((sum, oee) => sum + oee.availability, 0) / machineOEE.length * 100).toFixed(1) : '-';
          const totalOutput = machineProduction.reduce((sum, prod) => sum + prod.output_qty, 0);
          const totalDefects = machineProduction.reduce((sum, prod) => sum + prod.defect_qty, 0);
          const defectRate = totalOutput > 0 ? ((totalDefects / totalOutput) * 100).toFixed(2) : '0.00';

          analysisData.push([
            machine.name || '',
            avgOEE,
            avgAvailability,
            totalOutput,
            defectRate
          ]);
        }
      });
    }

    return analysisData;
  }

  // 템플릿별 보고서 생성
  static async generateTemplateReport(
    templateType: 'daily' | 'weekly' | 'monthly',
    data: ReportData,
    format: 'pdf' | 'excel',
    charts?: ChartData[]
  ): Promise<void> {
    const templateData = {
      ...data,
      reportType: templateType as ReportData['reportType']
    };

    if (format === 'pdf') {
      await this.generatePDFReport(templateData, charts);
    } else {
      await this.generateExcelReport(templateData);
    }
  }

  // 빠른 보고서 생성 (기본 설정)
  static async generateQuickReport(
    machines: Machine[],
    oeeData: OEEMetrics[],
    productionData: ProductionRecord[],
    format: 'pdf' | 'excel' = 'pdf'
  ): Promise<void> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 7); // 최근 7일

    const reportData: ReportData = {
      machines,
      oeeData,
      productionData,
      reportType: 'summary',
      dateRange: [
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      ],
      selectedMachines: machines.map(m => m.id),
      includeCharts: true,
      includeOEE: true,
      includeProduction: true,
      includeDowntime: true,
      groupBy: 'machine'
    };

    if (format === 'pdf') {
      await this.generatePDFReport(reportData);
    } else {
      await this.generateExcelReport(reportData);
    }
  }

  // 차트 데이터를 포함한 고급 보고서 생성
  static async generateAdvancedReport(
    data: ReportData,
    format: 'pdf' | 'excel',
    chartElements: { [key: string]: HTMLCanvasElement | HTMLElement }
  ): Promise<void> {
    const charts: ChartData[] = [];

    // 차트 요소들을 이미지로 변환
    for (const [key, element] of Object.entries(chartElements)) {
      try {
        let chartImage: string;
        
        if (element instanceof HTMLCanvasElement) {
          chartImage = await this.captureChartAsImage(element);
        } else {
          chartImage = await this.captureElementAsImage(element);
        }

        if (chartImage) {
          charts.push({
            chartImage,
            title: this.getChartTitle(key),
            type: this.getChartType(key)
          });
        }
      } catch (error) {
        console.error(`차트 캡처 실패 (${key}):`, error);
      }
    }

    if (format === 'pdf') {
      await this.generatePDFReport(data, charts);
    } else {
      await this.generateExcelReport(data);
    }
  }

  // 차트 제목 매핑
  static getChartTitle(chartKey: string): string {
    const titleMap: { [key: string]: string } = {
      'oee-gauge': 'OEE 게이지',
      'trend-chart': 'OEE 추이 차트',
      'downtime-chart': '다운타임 분석',
      'production-chart': '생산 실적 차트'
    };
    return titleMap[chartKey] || chartKey;
  }

  // 차트 타입 매핑
  static getChartType(chartKey: string): ChartData['type'] {
    const typeMap: { [key: string]: ChartData['type'] } = {
      'oee-gauge': 'oee-gauge',
      'trend-chart': 'trend',
      'downtime-chart': 'downtime',
      'production-chart': 'production'
    };
    return typeMap[chartKey] || 'oee-gauge';
  }

  // 보고서 미리보기 데이터 생성
  static generatePreviewData(data: ReportData): {
    summary: {
      reportType: string;
      dateRange: [string, string];
      machineCount: number;
      oeeDataCount: number;
      productionDataCount: number;
    };
    chartCount: number;
    pageCount: number;
  } {
    const summary = {
      reportType: data.reportType,
      dateRange: data.dateRange,
      machineCount: data.machines.length,
      oeeDataCount: data.oeeData.length,
      productionDataCount: data.productionData.length
    };

    let chartCount = 0;
    if (data.includeCharts) {
      if (data.includeOEE) chartCount += 2; // OEE 게이지 + 추이
      if (data.includeDowntime) chartCount += 1; // 다운타임 차트
      if (data.includeProduction) chartCount += 1; // 생산 차트
    }

    // 대략적인 페이지 수 계산
    let pageCount = 2; // 표지 + 목차
    if (data.machines.length > 0) pageCount += Math.ceil(data.machines.length / 20);
    if (data.includeOEE) pageCount += 1;
    if (data.includeProduction) pageCount += 1;
    if (chartCount > 0) pageCount += Math.ceil(chartCount / 2);

    return { summary, chartCount, pageCount };
  }
}