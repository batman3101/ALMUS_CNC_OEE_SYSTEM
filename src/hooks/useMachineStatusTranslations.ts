import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useMachinesTranslation } from '@/hooks/useTranslation';

export interface MachineStatusTranslation {
  status: string;
  description_ko: string;
  description_vi: string;
  description_en: string;
  display_order: number;
  color_code: string;
  is_productive: boolean;
  requires_reason: boolean;
}

export interface StatusConfig {
  color: string;
  icon: React.ReactNode;
  text: string;
  colorCode: string;
  isProductive: boolean;
  requiresReason: boolean;
}

export const useMachineStatusTranslations = (language: 'ko' | 'vi' | 'en' = 'ko') => {
  const { t } = useMachinesTranslation();
  const [statusTranslations, setStatusTranslations] = useState<MachineStatusTranslation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatusTranslations = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('machine_status_descriptions')
          .select('*')
          .order('display_order', { ascending: true });

        if (fetchError) {
          throw fetchError;
        }

        setStatusTranslations(data || []);
      } catch (err) {
        console.error('상태 번역 정보 로드 실패:', err);
        setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다');
      } finally {
        setIsLoading(false);
      }
    };

    fetchStatusTranslations();
  }, []);

  // 특정 상태의 번역된 텍스트 가져오기
  const getStatusText = (status: string): string => {
    const statusInfo = statusTranslations.find(s => s.status === status);
    
    if (!statusInfo) {
      // 데이터베이스에 없는 경우 t함수 폴백 사용
      return t(`status.${status}`) || status;
    }

    // 언어별 텍스트 반환
    switch (language) {
      case 'vi':
        return statusInfo.description_vi || statusInfo.description_en || statusInfo.description_ko || status;
      case 'en':
        return statusInfo.description_en || statusInfo.description_ko || status;
      case 'ko':
      default:
        return statusInfo.description_ko || statusInfo.description_en || status;
    }
  };

  // 특정 상태의 색상 코드 가져오기
  const getStatusColorCode = (status: string): string => {
    const statusInfo = statusTranslations.find(s => s.status === status);
    return statusInfo?.color_code || '#8c8c8c';
  };

  // 특정 상태의 생산성 여부 가져오기
  const getStatusProductivity = (status: string): boolean => {
    const statusInfo = statusTranslations.find(s => s.status === status);
    return statusInfo?.is_productive || false;
  };

  // 특정 상태의 사유 필요 여부 가져오기
  const getStatusReasonRequired = (status: string): boolean => {
    const statusInfo = statusTranslations.find(s => s.status === status);
    return statusInfo?.requires_reason || false;
  };

  // Ant Design 색상 매핑을 위한 함수
  const getAntdColorFromHex = (hexColor: string): string => {
    const colorMap: { [key: string]: string } = {
      '#52C41A': 'success',  // 정상가동 - 초록색
      '#1890FF': 'processing', // 점검중 - 파란색  
      '#FF4D4F': 'error',    // 고장수리중 - 빨간색
      '#FA8C16': 'warning',  // PM중 - 주황색
      '#722ED1': 'processing', // 모델교체 - 보라색
      '#8C8C8C': 'default',  // 계획정지 - 회색
      '#13C2C2': 'processing', // 프로그램 교체 - 청록색
      '#EB2F96': 'processing', // 공구교환 - 분홍색
      '#FAAD14': 'warning'   // 일시정지 - 노란색
    };
    
    return colorMap[hexColor] || 'default';
  };

  // 모든 상태 목록을 번역과 함께 반환
  const getAllStatusOptions = () => {
    return statusTranslations.map(status => ({
      value: status.status,
      label: getStatusText(status.status),
      color: getAntdColorFromHex(status.color_code),
      colorCode: status.color_code,
      isProductive: status.is_productive,
      requiresReason: status.requires_reason,
      displayOrder: status.display_order
    }));
  };

  return {
    statusTranslations,
    isLoading,
    error,
    getStatusText,
    getStatusColorCode,
    getStatusProductivity, 
    getStatusReasonRequired,
    getAntdColorFromHex,
    getAllStatusOptions
  };
};