// 한국어 폰트 지원을 위한 유틸리티
import jsPDF from 'jspdf';

// 한국어를 지원하는 시스템 폰트 목록
const KOREAN_FONTS = [
  'Malgun Gothic',
  'Noto Sans KR', 
  'NanumGothic',
  'NanumBarunGothic',
  'Apple SD Gothic Neo',
  'Arial Unicode MS',
  'Microsoft Sans Serif'
];

// 브라우저에서 지원하는 한국어 폰트 감지
export function detectKoreanFont(): string {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  
  if (!context) {
    return 'Arial';
  }

  // 각 폰트를 테스트해서 한국어를 제대로 렌더링하는 폰트 찾기
  const testText = '한글';
  const baseFontSize = '12px Arial';
  
  context.font = baseFontSize;
  const baseWidth = context.measureText(testText).width;

  for (const font of KOREAN_FONTS) {
    try {
      context.font = `12px "${font}", Arial, sans-serif`;
      const testWidth = context.measureText(testText).width;
      
      // 폰트가 한글을 제대로 렌더링하면 너비가 달라짐
      if (Math.abs(testWidth - baseWidth) > 1) {
        console.log(`한국어 폰트 감지됨: ${font}`);
        return font;
      }
    } catch (error) {
      console.warn(`폰트 테스트 실패: ${font}`, error);
      continue;
    }
  }
  
  return 'Arial';
}

// jsPDF에서 한국어 텍스트를 안전하게 처리하는 함수
export function addKoreanText(
  doc: jsPDF, 
  text: string, 
  x: number, 
  y: number, 
  options: { align?: 'left' | 'center' | 'right', maxWidth?: number } = {}
): void {
  try {
    // 한국어 문자가 포함된 경우 특별 처리
    const hasKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(text);
    
    if (hasKorean) {
      // 한국어 텍스트를 이미지로 변환하여 추가
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        const koreanFont = detectKoreanFont();
        const fontSize = 12; // 기본 폰트 크기
        
        ctx.font = `${fontSize}px "${koreanFont}", sans-serif`;
        const metrics = ctx.measureText(text);
        
        canvas.width = Math.max(options.maxWidth || metrics.width + 10, metrics.width + 10);
        canvas.height = fontSize + 6;
        
        // 배경을 투명하게 설정
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 텍스트 스타일 재설정 (캔버스 크기 변경 후)
        ctx.font = `${fontSize}px "${koreanFont}", sans-serif`;
        ctx.fillStyle = '#000000';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        
        // 텍스트 그리기
        ctx.fillText(text, 3, canvas.height / 2);
        
        // 이미지로 PDF에 추가
        const imageData = canvas.toDataURL('image/png');
        const imgWidth = canvas.width * 0.3; // 적절한 크기로 조정
        const imgHeight = canvas.height * 0.3;
        
        let adjustedX = x;
        if (options.align === 'center') {
          adjustedX = x - imgWidth / 2;
        } else if (options.align === 'right') {
          adjustedX = x - imgWidth;
        }
        
        doc.addImage(imageData, 'PNG', adjustedX, y - imgHeight / 2, imgWidth, imgHeight);
        return;
      }
    }
    
    // 영어 또는 한국어 이미지 생성 실패시 기본 텍스트
    if (options.align) {
      doc.text(text, x, y, { align: options.align });
    } else {
      doc.text(text, x, y);
    }
    
  } catch (error) {
    console.error('한국어 텍스트 추가 실패:', error);
    // 폴백: 기본 텍스트
    if (options.align) {
      doc.text(text, x, y, { align: options.align });
    } else {
      doc.text(text, x, y);
    }
  }
}

// autoTable에서 사용할 한국어 지원 옵션
export const getKoreanTableOptions = () => {
  // detectKoreanFont() is called for potential future font customization
  detectKoreanFont();

  return {
    styles: {
      font: 'helvetica', // jsPDF 기본 폰트 유지
      fontSize: 9,
      cellPadding: 3,
      halign: 'center' as const,
      lineColor: [0, 0, 0],
      lineWidth: 0.1
    },
    headStyles: {
      fillColor: [230, 230, 230],
      textColor: [0, 0, 0],
      fontSize: 10,
      fontStyle: 'bold' as const,
      font: 'helvetica'
    },
    alternateRowStyles: {
      fillColor: [248, 248, 248]
    },
    theme: 'grid' as const
  };
};