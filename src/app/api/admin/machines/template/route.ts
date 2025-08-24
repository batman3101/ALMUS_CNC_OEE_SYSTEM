import { NextRequest, NextResponse } from 'next/server';
import { createMachineTemplate } from '@/lib/excel/machineTemplate';

// GET /api/admin/machines/template - Excel 템플릿 다운로드
export async function GET(request: NextRequest) {
  try {
    // Excel 템플릿 생성
    const excelBuffer = createMachineTemplate();

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