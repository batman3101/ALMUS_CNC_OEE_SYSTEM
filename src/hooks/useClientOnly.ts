'use client';

import { useEffect, useState } from 'react';

/**
 * 클라이언트에서만 실행되는 상태를 관리하는 훅
 * 하이드레이션 오류를 방지하기 위해 사용
 */
export const useClientOnly = () => {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return isClient;
};

/**
 * 클라이언트에서만 데이터를 생성하는 훅
 * 서버 사이드 렌더링 시에는 기본값을 사용하고,
 * 클라이언트에서 마운트된 후에 실제 데이터를 생성
 */
export const useClientData = <T>(
  dataGenerator: () => T,
  defaultValue: T
): T => {
  const [data, setData] = useState<T>(defaultValue);
  const isClient = useClientOnly();

  useEffect(() => {
    if (isClient) {
      setData(dataGenerator());
    }
  }, [isClient, dataGenerator]);

  return data;
};