import * as XLSX from 'xlsx';

export interface MachineTemplateRow {
  설비명: string;
  위치: string;
  '설비 타입': string;
  '생산 모델': string;
  '가공 공정': string;
  '활성 상태': '활성' | '비활성' | 'Y' | 'N';
  '현재 상태': '정상가동' | '점검중' | '고장수리중' | 'PM중' | '모델교체' | '계획정지' | '프로그램교체' | '공구교환' | '일시정지';
}

export interface MachineImportData {
  name: string;
  location: string | null;
  equipment_type: string | null;
  production_model_name: string;
  process_name: string;
  is_active: boolean;
  current_state: 'NORMAL_OPERATION' | 'INSPECTION' | 'BREAKDOWN_REPAIR' | 'PM_MAINTENANCE' | 'MODEL_CHANGE' | 'PLANNED_STOP' | 'PROGRAM_CHANGE' | 'TOOL_CHANGE' | 'TEMPORARY_STOP';
}

// Excel 템플릿 생성
export function createMachineTemplate(): Uint8Array {
  // 템플릿 데이터
  const templateData: MachineTemplateRow[] = [
    {
      설비명: 'CNC-001',
      위치: 'A동 1층',
      '설비 타입': 'DMG MORI',
      '생산 모델': 'PA1',
      '가공 공정': 'CNC #1',
      '활성 상태': 'Y',
      '현재 상태': '정상가동'
    },
    {
      설비명: 'CNC-002',
      위치: 'A동 1층',
      '설비 타입': 'MAZAK',
      '생산 모델': 'PA2',
      '가공 공정': 'CNC #2',
      '활성 상태': 'Y',
      '현재 상태': '점검중'
    }
  ];

  // 워크북 생성
  const wb = XLSX.utils.book_new();
  
  // 데이터 시트
  const ws = XLSX.utils.json_to_sheet(templateData);
  
  // 컬럼 너비 설정
  ws['!cols'] = [
    { wch: 15 }, // 설비명
    { wch: 20 }, // 위치
    { wch: 15 }, // 설비 타입
    { wch: 15 }, // 생산 모델
    { wch: 15 }, // 가공 공정
    { wch: 12 }, // 활성 상태
    { wch: 15 }, // 현재 상태
  ];

  // 안내 시트 생성
  const instructionData = [
    ['설비 일괄등록 템플릿 사용 안내'],
    [''],
    ['1. 필수 입력 항목'],
    ['   - 설비명: 고유한 설비 이름 (중복 불가)'],
    ['   - 위치: 설비가 위치한 장소 (예: A동 1층)'],
    ['   - 생산 모델: 데이터베이스에 등록된 생산 모델명 (예: PA1, PA2)'],
    ['   - 가공 공정: 해당 생산 모델의 공정명 (예: CNC #1, CNC #2)'],
    [''],
    ['2. 선택 입력 항목'],
    ['   - 설비 타입: 설비 제조사/모델 (예: DMG MORI, MAZAK, HAAS)'],
    ['   - 활성 상태: Y/N, 활성/비활성 (기본값: Y)'],
    ['   - 현재 상태: 현재 설비 상태 (기본값: 정상가동)'],
    [''],
    ['3. 현재 상태 가능한 값'],
    ['   - 정상가동: 정상적으로 가동 중'],
    ['   - 점검중: 점검/보수 중'],
    ['   - 고장수리중: 고장 수리 중'],
    ['   - PM중: PM 정비 중'],
    ['   - 모델교체: 모델 변경 작업 중'],
    ['   - 계획정지: 계획된 정지'],
    ['   - 프로그램교체: 프로그램 변경 중'],
    ['   - 공구교환: 공구 교체 중'],
    ['   - 일시정지: 임시 정지 상태'],
    [''],
    ['4. 사용 가능한 생산 모델 및 공정'],
    ['   - PA1 (S 25): CNC #1 (60초), CNC #2 (180초)'],
    ['   - PA2 (S 25 PLUS): CNC #1 (45초), CNC #2 (120초)'],
    ['   - PA3 (S 25 ULTRA): CNC #1 (90초), CNC #2 (300초)'],
    ['   (Tact Time은 자동으로 설정됩니다)'],
    [''],
    ['5. 주의사항'],
    ['   - 엑셀 파일 형식: .xlsx'],
    ['   - 한 번에 최대 1000개까지 등록 가능'],
    ['   - 설비명은 반드시 고유해야 함'],
    ['   - 생산 모델과 공정은 데이터베이스에 등록된 것만 사용 가능'],
    ['   - 시트명을 변경하지 마세요'],
  ];

  const wsInstruction = XLSX.utils.aoa_to_sheet(instructionData);
  wsInstruction['!cols'] = [{ wch: 80 }];

  // 시트 추가
  XLSX.utils.book_append_sheet(wb, ws, '설비목록');
  XLSX.utils.book_append_sheet(wb, wsInstruction, '작성가이드');

  // Uint8Array로 변환
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(excelBuffer);
}

// Excel 파일 파싱
export function parseMachineExcel(buffer: ArrayBuffer): MachineTemplateRow[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  
  // '설비목록' 시트 찾기
  const sheetName = '설비목록';
  const ws = wb.Sheets[sheetName];
  
  if (!ws) {
    throw new Error('설비목록 시트를 찾을 수 없습니다.');
  }

  // JSON으로 변환
  const jsonData = XLSX.utils.sheet_to_json<MachineTemplateRow>(ws);
  
  if (jsonData.length === 0) {
    throw new Error('데이터가 없습니다.');
  }

  if (jsonData.length > 1000) {
    throw new Error('한 번에 최대 1000개까지만 등록 가능합니다.');
  }

  return jsonData;
}

// 템플릿 데이터를 DB 형식으로 변환
export function convertToMachineData(templateRow: MachineTemplateRow): MachineImportData {
  // 상태 매핑
  const stateMap: Record<string, MachineImportData['current_state']> = {
    '정상가동': 'NORMAL_OPERATION',
    '점검중': 'INSPECTION',
    '고장수리중': 'BREAKDOWN_REPAIR',
    'PM중': 'PM_MAINTENANCE',
    '모델교체': 'MODEL_CHANGE',
    '계획정지': 'PLANNED_STOP',
    '프로그램교체': 'PROGRAM_CHANGE',
    '공구교환': 'TOOL_CHANGE',
    '일시정지': 'TEMPORARY_STOP'
  };

  // 활성 상태 처리
  let isActive = true;
  const activeValue = templateRow['활성 상태'];
  if (activeValue) {
    const activeStr = activeValue.toString().trim().toUpperCase();
    isActive = !['N', 'NO', '아니오', '비활성', '미사용', '0', 'FALSE'].includes(activeStr);
  }

  return {
    name: templateRow.설비명.trim(),
    location: templateRow.위치?.trim() || null,
    equipment_type: templateRow['설비 타입']?.trim() || null,
    production_model_name: templateRow['생산 모델'].trim(),
    process_name: templateRow['가공 공정'].trim(),
    is_active: isActive,
    current_state: stateMap[templateRow['현재 상태']] || 'NORMAL_OPERATION'
  };
}

// 데이터 유효성 검사
export function validateMachineData(data: MachineTemplateRow[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nameSet = new Set<string>();

  const validStates = ['정상가동', '점검중', '고장수리중', 'PM중', '모델교체', '계획정지', '프로그램교체', '공구교환', '일시정지'];
  const validActiveValues = ['Y', 'N', '활성', '비활성', 'YES', 'NO', '예', '아니오', '사용', '미사용', '1', '0', 'TRUE', 'FALSE'];

  data.forEach((row, index) => {
    const rowNum = index + 2; // 헤더 + 0-based index

    // 필수 필드 검사
    if (!row.설비명) {
      errors.push(`행 ${rowNum}: 설비명은 필수입니다.`);
    } else {
      // 중복 검사
      if (nameSet.has(row.설비명.trim())) {
        errors.push(`행 ${rowNum}: 설비명 "${row.설비명}"이 중복됩니다.`);
      }
      nameSet.add(row.설비명.trim());
    }

    if (!row.위치) {
      errors.push(`행 ${rowNum}: 위치는 필수입니다.`);
    }

    if (!row['생산 모델']) {
      errors.push(`행 ${rowNum}: 생산 모델은 필수입니다.`);
    }

    if (!row['가공 공정']) {
      errors.push(`행 ${rowNum}: 가공 공정은 필수입니다.`);
    }

    // 선택값 검사
    const activeState = row['활성 상태'];
    if (activeState && !validActiveValues.includes(activeState.toString().trim().toUpperCase())) {
      errors.push(`행 ${rowNum}: 활성 상태는 Y/N, 활성/비활성, 1/0 중 하나여야 합니다.`);
    }

    const currentState = row['현재 상태'];
    if (currentState && !validStates.includes(currentState)) {
      errors.push(`행 ${rowNum}: 현재 상태는 "${validStates.join(', ')}" 중 하나여야 합니다.`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}