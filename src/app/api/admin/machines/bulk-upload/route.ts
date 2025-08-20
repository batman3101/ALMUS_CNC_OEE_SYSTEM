import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import * as XLSX from 'xlsx';

interface ExcelMachineData {
  name: string;
  location: string;
  model_type: string;
  processing_step: string;
  default_tact_time: number;
  is_active: boolean;
  current_state: string;
}

interface ValidationError {
  row: number;
  field: string;
  message: string;
  value: any;
}

// POST /api/admin/machines/bulk-upload - Excel 파일로 설비 일괄 등록
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'Excel 파일이 필요합니다.' },
        { status: 400 }
      );
    }

    // 파일 형식 검증
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv' // .csv
    ];

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: '지원되는 파일 형식: .xlsx, .xls, .csv' },
        { status: 400 }
      );
    }

    // 파일 크기 제한 (10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: '파일 크기는 10MB를 초과할 수 없습니다.' },
        { status: 400 }
      );
    }

    // 파일 읽기
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // JSON으로 변환
    const rawData = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1,
      defval: '' 
    }) as any[][];

    if (rawData.length < 2) {
      return NextResponse.json(
        { error: '데이터가 없습니다. 헤더와 최소 1행의 데이터가 필요합니다.' },
        { status: 400 }
      );
    }

    // 헤더 추출 및 검증
    const headers = rawData[0] as string[];
    const requiredHeaders = [
      '설비명', '위치', '모델', '가공 공정', '기본 Tact Time', '활성 상태', '현재 상태'
    ];

    const missingHeaders = requiredHeaders.filter(header => 
      !headers.some(h => h && h.toString().trim() === header)
    );

    if (missingHeaders.length > 0) {
      return NextResponse.json(
        { 
          error: '필수 컬럼이 누락되었습니다.',
          missing_headers: missingHeaders,
          expected_headers: requiredHeaders
        },
        { status: 400 }
      );
    }

    // 헤더 인덱스 매핑
    const headerMap = requiredHeaders.reduce((map, header) => {
      const index = headers.findIndex(h => h && h.toString().trim() === header);
      map[header] = index;
      return map;
    }, {} as Record<string, number>);

    // 데이터 파싱 및 검증
    const machines: ExcelMachineData[] = [];
    const validationErrors: ValidationError[] = [];
    
    // 상태 값 매핑
    const stateMapping: Record<string, string> = {
      '정상가동': 'NORMAL_OPERATION',
      '정상 가동': 'NORMAL_OPERATION', 
      '가동': 'NORMAL_OPERATION',
      '점검중': 'MAINTENANCE',
      '점검': 'MAINTENANCE',
      '보수': 'MAINTENANCE',
      '모델교체': 'MODEL_CHANGE',
      '모델 교체': 'MODEL_CHANGE',
      '계획정지': 'PLANNED_STOP',
      '계획 정지': 'PLANNED_STOP',
      '정지': 'PLANNED_STOP',
      '프로그램교체': 'PROGRAM_CHANGE',
      '프로그램 교체': 'PROGRAM_CHANGE',
      '공구교환': 'TOOL_CHANGE',
      '공구 교환': 'TOOL_CHANGE',
      '일시정지': 'TEMPORARY_STOP',
      '일시 정지': 'TEMPORARY_STOP'
    };

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNum = i + 1;

      // 빈 행 건너뛰기
      if (!row || row.every(cell => !cell || cell.toString().trim() === '')) {
        continue;
      }

      try {
        const machine: ExcelMachineData = {
          name: row[headerMap['설비명']]?.toString().trim() || '',
          location: row[headerMap['위치']]?.toString().trim() || '',
          model_type: row[headerMap['모델']]?.toString().trim() || '',
          processing_step: row[headerMap['가공 공정']]?.toString().trim() || '',
          default_tact_time: 0,
          is_active: true,
          current_state: 'NORMAL_OPERATION'
        };

        // 필수 필드 검증
        if (!machine.name) {
          validationErrors.push({
            row: rowNum,
            field: '설비명',
            message: '설비명은 필수입니다.',
            value: machine.name
          });
        }

        if (!machine.location) {
          validationErrors.push({
            row: rowNum,
            field: '위치',
            message: '위치는 필수입니다.',
            value: machine.location
          });
        }

        if (!machine.model_type) {
          validationErrors.push({
            row: rowNum,
            field: '모델',
            message: '모델은 필수입니다.',
            value: machine.model_type
          });
        }

        if (!machine.processing_step) {
          validationErrors.push({
            row: rowNum,
            field: '가공 공정',
            message: '가공 공정은 필수입니다.',
            value: machine.processing_step
          });
        }

        // Tact Time 처리
        const tactTimeValue = row[headerMap['기본 Tact Time']];
        if (tactTimeValue) {
          const tactTime = parseFloat(tactTimeValue.toString());
          if (isNaN(tactTime) || tactTime <= 0) {
            validationErrors.push({
              row: rowNum,
              field: '기본 Tact Time',
              message: 'Tact Time은 0보다 큰 숫자여야 합니다.',
              value: tactTimeValue
            });
          } else {
            machine.default_tact_time = tactTime;
          }
        } else {
          machine.default_tact_time = 60; // 기본값
        }

        // 활성 상태 처리
        const activeValue = row[headerMap['활성 상태']];
        if (activeValue) {
          const activeStr = activeValue.toString().trim();
          if (['Y', 'YES', '예', '활성', '사용', '1', 'TRUE', 'true'].includes(activeStr.toUpperCase())) {
            machine.is_active = true;
          } else if (['N', 'NO', '아니오', '비활성', '미사용', '0', 'FALSE', 'false'].includes(activeStr.toUpperCase())) {
            machine.is_active = false;
          } else {
            validationErrors.push({
              row: rowNum,
              field: '활성 상태',
              message: '활성 상태는 Y/N, 예/아니오, 활성/비활성, 1/0 중 하나여야 합니다.',
              value: activeValue
            });
          }
        }

        // 현재 상태 처리
        const stateValue = row[headerMap['현재 상태']];
        if (stateValue) {
          const stateStr = stateValue.toString().trim();
          const mappedState = stateMapping[stateStr] || stateMapping[stateStr.toUpperCase()];
          if (mappedState) {
            machine.current_state = mappedState;
          } else {
            validationErrors.push({
              row: rowNum,
              field: '현재 상태',
              message: `지원하지 않는 상태입니다. 가능한 값: ${Object.keys(stateMapping).join(', ')}`,
              value: stateValue
            });
          }
        }

        // 중복 설비명 검사
        if (machines.some(m => m.name === machine.name)) {
          validationErrors.push({
            row: rowNum,
            field: '설비명',
            message: '중복된 설비명입니다.',
            value: machine.name
          });
        }

        machines.push(machine);
      } catch (error) {
        validationErrors.push({
          row: rowNum,
          field: '전체',
          message: `행 처리 중 오류: ${error}`,
          value: row
        });
      }
    }

    // 검증 오류가 있으면 반환
    if (validationErrors.length > 0) {
      return NextResponse.json({
        success: false,
        error: '데이터 검증 오류가 발생했습니다.',
        validation_errors: validationErrors,
        total_rows: rawData.length - 1,
        valid_rows: machines.length,
        error_rows: validationErrors.length
      }, { status: 422 });
    }

    // 기존 설비명과 중복 검사
    const existingNames = machines.map(m => m.name);
    const { data: existingMachines, error: checkError } = await supabaseAdmin
      .from('machines')
      .select('name')
      .in('name', existingNames);

    if (checkError) {
      console.error('Error checking existing machines:', checkError);
    }

    const duplicateNames = existingMachines?.map(m => m.name) || [];
    if (duplicateNames.length > 0) {
      return NextResponse.json({
        success: false,
        error: '이미 등록된 설비가 있습니다.',
        duplicate_names: duplicateNames,
        total_machines: machines.length,
        duplicate_count: duplicateNames.length
      }, { status: 409 });
    }

    // 데이터베이스에 일괄 삽입
    const { data: insertedMachines, error: insertError } = await supabaseAdmin
      .from('machines')
      .insert(machines)
      .select();

    if (insertError) {
      console.error('Error inserting machines:', insertError);
      return NextResponse.json(
        { error: '설비 등록 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `${machines.length}개의 설비가 성공적으로 등록되었습니다.`,
      inserted_count: insertedMachines?.length || 0,
      inserted_machines: insertedMachines
    });

  } catch (error) {
    console.error('Error in bulk upload:', error);
    return NextResponse.json(
      { error: '파일 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}