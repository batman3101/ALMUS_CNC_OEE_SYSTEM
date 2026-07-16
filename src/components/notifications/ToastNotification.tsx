'use client';

import React, { useEffect } from 'react';
import { App } from 'antd';
import { 
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons';
import { ToastNotificationOptions } from '@/types/notifications';

type NotificationInstance = ReturnType<typeof App.useApp>['notification'];

let notificationApi: NotificationInstance | null = null;

// Toast 알림 표시 함수
export const showToast = (options: ToastNotificationOptions) => {
  const api = notificationApi;
  if (!api) return;

  const { type, title, message, duration, action } = options;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      case 'warning':
        return <ExclamationCircleOutlined style={{ color: '#faad14' }} />;
      case 'info':
      default:
        return <InfoCircleOutlined style={{ color: '#1890ff' }} />;
    }
  };

  const notificationConfig = {
    message: title,
    description: message,
    icon: getIcon(),
    duration: duration ? duration / 1000 : 4.5, // antd는 초 단위
    ...(action && {
      btn: (
        <button
          onClick={() => {
            action.onClick();
            api.destroy();
          }}
          style={{
            background: 'transparent',
            border: '1px solid #d9d9d9',
            borderRadius: '6px',
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          {action.label}
        </button>
      )
    })
  };

  switch (type) {
    case 'success':
      api.success(notificationConfig);
      break;
    case 'error':
      api.error(notificationConfig);
      break;
    case 'warning':
      api.warning(notificationConfig);
      break;
    case 'info':
    default:
      api.info(notificationConfig);
      break;
  }
};

interface ToastNotificationProviderProps {
  children: React.ReactNode;
}

export const ToastNotificationProvider: React.FC<ToastNotificationProviderProps> = ({ children }) => {
  const { notification } = App.useApp();

  useEffect(() => {
    notificationApi = notification;

    return () => {
      if (notificationApi === notification) {
        notificationApi = null;
      }
    };
  }, [notification]);

  return <>{children}</>;
};

// 편의 함수들
export const toastSuccess = (title: string, message: string, options?: Partial<ToastNotificationOptions>) => {
  showToast({ type: 'success', title, message, ...options });
};

export const toastError = (title: string, message: string, options?: Partial<ToastNotificationOptions>) => {
  showToast({ type: 'error', title, message, ...options });
};

export const toastWarning = (title: string, message: string, options?: Partial<ToastNotificationOptions>) => {
  showToast({ type: 'warning', title, message, ...options });
};

export const toastInfo = (title: string, message: string, options?: Partial<ToastNotificationOptions>) => {
  showToast({ type: 'info', title, message, ...options });
};

// 모든 Toast 알림 제거
export const clearAllToasts = () => {
  notificationApi?.destroy();
};
