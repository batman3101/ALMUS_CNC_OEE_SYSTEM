import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// GET /api/admin/machines/template - Excel 템플릿 다운로드
export async function GET(request: NextRequest) {
  try {
    // 템플릿 데이터 정의
    const headers = [
      '설비명',
      '위치',
      '모델',
      '가공 공정',
      '기본 Tact Time',
      '활성 상태',
      '현재 상태'
    ];

    // 샘플 데이터 (사용자 이해를 위한 예시)
    const sampleData = [
      [
        'CNC-001',
        'A동 12라인',
        'M3',
        '2 공정',
        60,
        'Y',
        '정상가동'
      ],
      [
        'CNC-002', 
        'B동 5라인',
        'M1',
        '1 공정',
        45,
        'Y',
        '점검중'
      ],
      [
        'CNC-003',
        'C동 8라인',
        'M4',
        '4 공정',
        75,
        'N',
        '계획정지'
      ],
      [
        '설비명을 입력하세요',
        '위치를 입력하세요 (예: A동 12라인)',
        '가공 모델명 (예: M3)',
        '1~4 공정 중 선택',
        '60',
        'Y 또는 N',
        '아래 상태 중 선택'
      ]
    ];

    // 새 워크북 생성
    const workbook = XLSX.utils.book_new();

    // 메인 시트 생성
    const mainData = [headers, ...sampleData];
    const mainSheet = XLSX.utils.aoa_to_sheet(mainData);

    // 컬럼 너비 설정
    mainSheet['!cols'] = [
      { wch: 15 }, // 설비명
      { wch: 20 }, // 위치
      { wch: 15 }, // 모델
      { wch: 15 }, // 가공 공정
      { wch: 18 }, // 기본 Tact Time
      { wch: 12 }, // 활성 상태
      { wch: 15 }  // 현재 상태
    ];

    // 헤더 스타일 설정
    for (let i = 0; i < headers.length; i++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: i });
      if (mainSheet[cellAddress]) {
        mainSheet[cellAddress].s = {
          fill: {
            fgColor: { rgb: "4472C4" }
          },
          font: {
            bold: true,
            color: { rgb: "FFFFFF" }
          },
          alignment: {
            horizontal: "center",
            vertical: "center"
          }
        };
      }
    }

    workbook.SheetNames.push("설비목록");
    workbook.Sheets["설비목록"] = mainSheet;

    // 가이드 시트 생성
    const guideHeaders = ['항목', '설명', '예시값', '필수여부'];
    const guideData = [
      guideHeaders,
      ['설비명', '고유한 설비 식별명', 'CNC-001, PRESS-A01', '필수'],
      ['위치', '설비가 위치한 공장/라인', 'A동 12라인, B동 5라인', '필수'],
      ['모델', '설비의 모델명', 'M3, M1, M4', '필수'],
      ['가공 공정', '설비의 가공 공정 단계', '1 공정, 2 공정, 3 공정, 4 공정', '필수'],
      ['기본 Tact Time', '기본 작업 시간(초)', '60, 45, 120', '선택(기본값:60)'],
      ['활성 상태', '설비 사용 여부', 'Y(사용), N(미사용)', '선택(기본값:Y)'],
      ['현재 상태', '설비의 현재 운영 상태', '아래 상태값 참조', '선택(기본값:정상가동)'],
      [],
      ['현재 상태 가능한 값:', '', '', ''],
      ['정상가동', '정상적으로 가동 중', '', ''],
      ['점검중', '점검/보수 중', '', ''],
      ['모델교체', '모델 변경 작업 중', '', ''],
      ['계획정지', '계획된 정지', '', ''],
      ['프로그램교체', '프로그램 변경 중', '', ''],
      ['공구교환', '공구 교체 중', '', ''],
      ['일시정지', '임시 정지 상태', '', ''],
      [],
      ['주의사항:', '', '', ''],
      ['1. 설비명은 중복될 수 없습니다', '', '', ''],
      ['2. 첫 번째 행(헤더)은 삭제하지 마세요', '', '', ''],
      ['3. 빈 행은 자동으로 무시됩니다', '', '', ''],
      ['4. 최대 1000개까지 한 번에 등록 가능합니다', '', '', ''],
      ['5. 파일 크기는 10MB를 초과할 수 없습니다', '', '', '']
    ];

    const guideSheet = XLSX.utils.aoa_to_sheet(guideData);
    
    // 가이드 시트 컬럼 너비 설정
    guideSheet['!cols'] = [
      { wch: 20 }, // 항목
      { wch: 40 }, // 설명
      { wch: 25 }, // 예시값
      { wch: 12 }  // 필수여부
    ];

    workbook.SheetNames.push("작성가이드");
    workbook.Sheets["작성가이드"] = guideSheet;

    // Excel 파일을 버퍼로 생성
    const excelBuffer = XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'buffer'
    });

    // 파일명 생성 (현재 날짜 포함)
    const currentDate = new Date().toISOString().split('T')[0];
    const filename = `설비등록_템플릿_${currentDate}.xlsx`;

    // 응답 헤더 설정
    const headers_response = new Headers();
    headers_response.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    headers_response.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    headers_response.set('Content-Length', excelBuffer.length.toString());

    return new NextResponse(excelBuffer, {
      status: 200,
      headers: headers_response
    });

  } catch (error) {
    console.error('Error generating template:', error);
    return NextResponse.json(
      { error: '템플릿 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}