import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';

// 이미지 업로드 제한 설정
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg', 
  'image/png',
  'image/webp',
  'image/gif'
];
const BUCKET_NAME = 'company-assets';

/**
 * 파일명 안전화 함수
 * 특수문자 제거 및 한글 파일명 지원
 */
function sanitizeFileName(fileName: string): string {
  // 파일 확장자와 이름 분리
  const lastDotIndex = fileName.lastIndexOf('.');
  const name = lastDotIndex !== -1 ? fileName.substring(0, lastDotIndex) : fileName;
  const extension = lastDotIndex !== -1 ? fileName.substring(lastDotIndex) : '';
  
  // 특수문자 제거 (한글, 영문, 숫자, 하이픈, 언더스코어만 허용)
  const sanitizedName = name
    .replace(/[^\w가-힣\-_\s]/g, '') // 허용되지 않는 문자 제거
    .replace(/\s+/g, '-') // 공백을 하이픈으로 변경
    .replace(/[-_]+/g, '-') // 연속된 하이픈/언더스코어를 단일 하이픈으로
    .replace(/^-|-$/g, ''); // 앞뒤 하이픈 제거
  
  return sanitizedName + extension.toLowerCase();
}

/**
 * 고유 파일명 생성 함수
 */
function generateUniqueFileName(originalFileName: string): string {
  const sanitizedName = sanitizeFileName(originalFileName);
  const timestamp = Date.now();
  const randomId = crypto.randomUUID().substring(0, 8);
  
  const lastDotIndex = sanitizedName.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return `${timestamp}-${randomId}-${sanitizedName}`;
  }
  
  const name = sanitizedName.substring(0, lastDotIndex);
  const extension = sanitizedName.substring(lastDotIndex);
  
  return `${timestamp}-${randomId}-${name}${extension}`;
}

/**
 * MIME 타입 검증 함수
 */
function validateMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase());
}

/**
 * 파일 크기 검증 함수
 */
function validateFileSize(size: number): boolean {
  return size > 0 && size <= MAX_FILE_SIZE;
}

// POST /api/upload/image - 이미지 업로드
export async function POST(request: NextRequest) {
  try {
    await requireUser(request, ['admin']);
    console.log('POST /api/upload/image called');

    // FormData로부터 파일 추출
    const formData = await request.formData();
    const file = formData.get('file') as File;

    // 파일 존재 여부 확인
    if (!file) {
      return NextResponse.json(
        { 
          success: false,
          error: '파일이 업로드되지 않았습니다.',
          message: '업로드할 파일을 선택해주세요.'
        },
        { status: 400 }
      );
    }

    console.log('File details:', {
      name: file.name,
      size: file.size,
      type: file.type
    });

    // MIME 타입 검증
    if (!validateMimeType(file.type)) {
      return NextResponse.json(
        { 
          success: false,
          error: '지원하지 않는 파일 형식입니다.',
          message: `허용되는 형식: ${ALLOWED_MIME_TYPES.join(', ')}`
        },
        { status: 415 }
      );
    }

    // 파일 크기 검증
    if (!validateFileSize(file.size)) {
      const maxSizeMB = MAX_FILE_SIZE / (1024 * 1024);
      return NextResponse.json(
        { 
          success: false,
          error: '파일 크기가 제한을 초과했습니다.',
          message: `최대 허용 크기: ${maxSizeMB}MB`
        },
        { status: 413 }
      );
    }

    // 고유 파일명 생성
    const uniqueFileName = generateUniqueFileName(file.name);
    console.log('Generated unique filename:', uniqueFileName);

    // 파일을 ArrayBuffer로 변환
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Supabase Storage에 업로드
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(uniqueFileName, uint8Array, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false // 동일한 파일명이 있으면 오류 발생
      });

    if (uploadError) {
      console.error('Supabase upload error:', uploadError);
      
      // 중복 파일명 에러 처리
      if (uploadError.message?.includes('duplicate') || uploadError.message?.includes('already exists')) {
        return NextResponse.json(
          { 
            success: false,
            error: '동일한 파일명이 이미 존재합니다.',
            message: '잠시 후 다시 시도해주세요.'
          },
          { status: 409 }
        );
      }
      
      throw uploadError;
    }

    console.log('Upload successful:', uploadData.path);

    // 공개 URL 생성
    const { data: urlData } = supabaseAdmin.storage
      .from(BUCKET_NAME)
      .getPublicUrl(uploadData.path);

    if (!urlData?.publicUrl) {
      throw new Error('공개 URL 생성에 실패했습니다.');
    }

    console.log('Public URL generated:', urlData.publicUrl);

    // 성공 응답
    return NextResponse.json({
      success: true,
      url: urlData.publicUrl,
      fileName: uniqueFileName,
      originalName: file.name,
      message: '이미지가 성공적으로 업로드되었습니다.'
    }, { status: 201 });

  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error in POST /api/upload/image:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: '이미지 업로드 중 오류가 발생했습니다.',
        message: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}

// GET 메서드는 지원하지 않음
export async function GET() {
  return NextResponse.json(
    { 
      success: false,
      error: 'GET 메서드는 지원하지 않습니다.',
      message: 'POST 메서드를 사용하여 이미지를 업로드해주세요.'
    },
    { status: 405 }
  );
}
