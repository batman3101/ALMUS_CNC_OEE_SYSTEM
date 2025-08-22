'use client';

import { message } from 'antd';
import { useCallback } from 'react';

/**
 * Custom hook for Ant Design message with proper context handling
 * This resolves the warning about static function usage
 */
export function useMessage() {
  const [messageApi, contextHolder] = message.useMessage();

  const showSuccess = useCallback((content: string, duration?: number) => {
    messageApi.success(content, duration);
  }, [messageApi]);

  const showError = useCallback((content: string, duration?: number) => {
    messageApi.error(content, duration);
  }, [messageApi]);

  const showInfo = useCallback((content: string, duration?: number) => {
    messageApi.info(content, duration);
  }, [messageApi]);

  const showWarning = useCallback((content: string, duration?: number) => {
    messageApi.warning(content, duration);
  }, [messageApi]);

  const showLoading = useCallback((content: string, duration?: number) => {
    return messageApi.loading(content, duration);
  }, [messageApi]);

  return {
    messageApi,
    contextHolder,
    success: showSuccess,
    error: showError,
    info: showInfo,
    warning: showWarning,
    loading: showLoading
  };
}