import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { 
  parseMachineExcel, 
  convertToMachineData, 
  validateMachineData, 
  type MachineImportData 
} from '@/lib/excel/machineTemplate';

interface ValidationError {
  row: number;
  field: string;
  message: string;
  value: any;
}

interface BulkUploadResult {
  success: boolean;
  message: string;
  inserted_count?: number;
  validation_errors?: ValidationError[];
  duplicate_names?: string[];
  total_rows?: number;
  valid_rows?: number;
  error_rows?: number;
  inserted_machines?: any[];
  preview_data?: MachineImportData[];
}

// POST /api/admin/machines/bulk-upload - Excel 파일로 설비 일괄 등록
export async function POST(request: NextRequest) {
  try {
    console.log('Content-Type:', request.headers.get('content-type'));
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const previewOnly = formData.get('preview') === 'true';
    
    console.log('File info:', {
      name: file?.name,
      type: file?.type,
      size: file?.size
    });

    if (!file) {
      return NextResponse.json(
        { error: 'Excel 파일이 필요합니다.' },
        { status: 400 }
      );
    }

    // 파일 형식 검증 (이름 기반 + MIME 타입 기반)
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/octet-stream' // 때로는 이렇게 전송됨
    ];

    const fileExtension = file.name?.toLowerCase().split('.').pop();
    const validExtensions = ['xlsx', 'xls'];

    if (!allowedTypes.includes(file.type) && !validExtensions.includes(fileExtension || '')) {
      return NextResponse.json(
        { 
          error: '지원되는 파일 형식: .xlsx, .xls',
          debug: {
            filename: file.name,
            mimeType: file.type,
            extension: fileExtension
          }
        },
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

    // 파일 파싱
    const arrayBuffer = await file.arrayBuffer();
    let templateData;
    
    try {
      templateData = parseMachineExcel(arrayBuffer);
    } catch (parseError) {
      return NextResponse.json(
        { error: `파일 파싱 오류: ${parseError instanceof Error ? parseError.message : '알 수 없는 오류'}` },
        { status: 400 }
      );
    }

    // 데이터 검증
    const validationResult = validateMachineData(templateData);
    
    if (!validationResult.valid) {
      const validationErrors = validationResult.errors.map((error, index) => ({
        row: index + 2, // Excel row numbers start from 1, plus header
        field: 'validation',
        message: error,
        value: ''
      }));

      return NextResponse.json({
        success: false,
        error: '데이터 검증 오류가 발생했습니다.',
        validation_errors: validationErrors,
        total_rows: templateData.length,
        valid_rows: 0,
        error_rows: validationErrors.length
      }, { status: 422 });
    }

    // 템플릿 데이터를 DB 형식으로 변환
    const machineData = templateData.map(convertToMachineData);

    // 미리보기 모드인 경우 데이터만 반환
    if (previewOnly) {
      return NextResponse.json({
        success: true,
        message: '데이터 미리보기가 완료되었습니다.',
        preview_data: machineData,
        total_rows: machineData.length,
        warnings: validationResult.warnings
      });
    }

    // 생산 모델명으로 생산 모델 ID와 공정 ID를 찾아서 변환
    const validationErrors: ValidationError[] = [];
    const dbMachineData = [];

    for (let i = 0; i < machineData.length; i++) {
      const machine = machineData[i];
      const rowNum = i + 2; // Excel row numbers start from 1, plus header

      // 먼저 생산 모델 조회
      const { data: productModel, error: modelError } = await supabaseAdmin
        .from('product_models')
        .select('id')
        .eq('model_name', machine.production_model_name)
        .eq('is_active', true)
        .single();

      if (modelError || !productModel) {
        validationErrors.push({
          row: rowNum,
          field: 'production_model',
          message: `생산 모델 "${machine.production_model_name}"을 찾을 수 없습니다.`,
          value: machine.production_model_name
        });
        continue;
      }

      // 해당 모델의 공정 조회
      const { data: processData, error: processError } = await supabaseAdmin
        .from('model_processes')
        .select('id')
        .eq('model_id', productModel.id)
        .eq('process_name', machine.process_name)
        .single();

      if (processError || !processData) {
        validationErrors.push({
          row: rowNum,
          field: 'process',
          message: `생산 모델 "${machine.production_model_name}"에서 공정 "${machine.process_name}"을 찾을 수 없습니다.`,
          value: `${machine.production_model_name} - ${machine.process_name}`
        });
        continue;
      }

      // DB에 삽입할 형태로 변환
      dbMachineData.push({
        name: machine.name,
        location: machine.location,
        equipment_type: machine.equipment_type,
        production_model_id: productModel.id,
        current_process_id: processData.id,
        is_active: machine.is_active,
        current_state: machine.current_state
      });
    }

    // 생산 모델/공정 검증 오류가 있는 경우 반환
    if (validationErrors.length > 0) {
      return NextResponse.json({
        success: false,
        error: '생산 모델 또는 공정 정보가 올바르지 않습니다.',
        validation_errors: validationErrors,
        total_rows: machineData.length,
        valid_rows: machineData.length - validationErrors.length,
        error_rows: validationErrors.length
      }, { status: 422 });
    }

    // 기존 설비명과 중복 검사
    const machineNames = dbMachineData.map(m => m.name);
    const { data: existingMachines, error: checkError } = await supabaseAdmin
      .from('machines')
      .select('name')
      .in('name', machineNames);

    if (checkError) {
      console.error('Error checking existing machines:', checkError);
      return NextResponse.json(
        { error: '기존 설비 확인 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

    const duplicateNames = existingMachines?.map(m => m.name) || [];
    if (duplicateNames.length > 0) {
      return NextResponse.json({
        success: false,
        error: '이미 등록된 설비가 있습니다.',
        duplicate_names: duplicateNames,
        total_machines: dbMachineData.length,
        duplicate_count: duplicateNames.length
      }, { status: 409 });
    }

    // 트랜잭션으로 일괄 삽입
    const { data: insertedMachines, error: insertError } = await supabaseAdmin
      .from('machines')
      .insert(dbMachineData)
      .select();

    if (insertError) {
      console.error('Error inserting machines:', insertError);
      return NextResponse.json(
        { error: `설비 등록 중 오류가 발생했습니다: ${insertError.message}` },
        { status: 500 }
      );
    }

    const result: BulkUploadResult = {
      success: true,
      message: `${dbMachineData.length}개의 설비가 성공적으로 등록되었습니다.`,
      inserted_count: insertedMachines?.length || 0,
      total_rows: templateData.length,
      valid_rows: dbMachineData.length,
      inserted_machines: insertedMachines
    };

    return NextResponse.json(result);

  } catch (error) {
    console.error('Error in bulk upload:', error);
    return NextResponse.json(
      { error: `파일 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}` },
      { status: 500 }
    );
  }
}