'use client';

import React from 'react';
import { Card, Alert, Space, Button, Typography, Empty, Spin } from 'antd';
import { 
  WarningOutlined, 
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  CloseCircleOutlined,
  EyeOutlined,
  CheckOutlined
} from '@ant-design/icons';
import { Notification, NotificationSeverity } from '@/types/notifications';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatDistanceToNow } from 'date-fns';
import { ko, vi } from 'date-fns/locale';

const { Text, Title } = Typography;

interface DashboardAlertsProps {
  notifications: Notification[];
  maxDisplay?: number;
  onAcknowledge?: (id: string) => Promise<void>;
  onViewAll?: () => void;
  loading?: boolean;
  title?: string;
}

export const DashboardAlerts: React.FC<DashboardAlertsProps> = ({
  notifications,
  maxDisplay = 5,
  onAcknowledge,
  onViewAll,
  loading = false,
  title
}) => {
  const { t, language } = useLanguage();

  // 활성 알림만 필터링하고 심각도 순으로 정렬
  const activeNotifications = notifications
    .filter(n => n.status === 'active')
    .sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    })
    .slice(0, maxDisplay);

  // 심각도별 아이콘
  const getSeverityIcon = (severity: NotificationSeverity) => {
    switch (severity) {
      case 'critical':
        return <CloseCircleOutlined />;
      case 'high':
        return <ExclamationCircleOutlined />;
      case 'medium':
        return <WarningOutlined />;
      case 'low':
        return <InfoCircleOutlined />;
      default:
        return <InfoCircleOutlined />;
    }
  };

  // 심각도별 Alert 타입
  const getSeverityType = (severity: NotificationSeverity): 'error' | 'warning' | 'info' => {
    switch (severity) {
      case 'critical':
        return 'error';
      case 'high':
      case 'medium':
        return 'warning';
      case 'low':
      default:
        return 'info';
    }
  };

  // 시간 포맷팅
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const locale = language === 'ko' ? ko : vi;
    return formatDistanceToNow(date, { 
      addSuffix: true, 
      locale 
    });
  };

  // 전체 활성 알림 수
  const totalActiveCount = notifications.filter(n => n.status === 'active').length;

  return (
    <Card 
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level={5} style={{ margin: 0 }}>
            {title || t('notifications.dashboardTitle')}
          </Title>
          {totalActiveCount > 0 && (
            <Text type="danger" strong>
              {totalActiveCount}{t('notifications.activeCount')}
            </Text>
          )}
        </div>
      }
      extra={
        totalActiveCount > maxDisplay && onViewAll && (
          <Button 
            type="link" 
            size="small" 
            icon={<EyeOutlined />}
            onClick={onViewAll}
          >
            {t('notifications.viewAll')}
          </Button>
        )
      }
      size="small"
    >
      <Spin spinning={loading}>
        {activeNotifications.length === 0 ? (
          <Empty 
            description={t('notifications.noActiveAlerts')}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ margin: '20px 0' }}
          />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            {activeNotifications.map((notification) => (
              <Alert
                key={notification.id}
                type={getSeverityType(notification.severity)}
                showIcon
                icon={getSeverityIcon(notification.severity)}
                message={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <Text strong style={{ fontSize: 13 }}>
                        {notification.machine_name}: {notification.title}
                      </Text>
                      <div style={{ marginTop: 2 }}>
                        <Text style={{ fontSize: 12, color: '#666' }}>
                          {notification.message}
                        </Text>
                      </div>
                      <div style={{ marginTop: 2 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {formatTime(notification.created_at)}
                        </Text>
                        {notification.current_value !== undefined && notification.threshold_value !== undefined && (
                          <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                            • {t('notifications.currentValue')}: {notification.current_value}
                            {notification.threshold_value && ` / ${t('notifications.threshold')}: ${notification.threshold_value}`}
                          </Text>
                        )}
                      </div>
                    </div>
                    {onAcknowledge && (
                      <Button
                        type="text"
                        size="small"
                        icon={<CheckOutlined />}
                        onClick={() => onAcknowledge(notification.id)}
                        style={{ marginLeft: 8, flexShrink: 0 }}
                        title={t('notifications.actions.acknowledge')}
                      />
                    )}
                  </div>
                }
                style={{
                  marginBottom: 0,
                  borderLeft: `4px solid ${
                    notification.severity === 'critical' ? '#ff4d4f' :
                    notification.severity === 'high' ? '#fa8c16' :
                    notification.severity === 'medium' ? '#faad14' : '#52c41a'
                  }`
                }}
              />
            ))}
          </Space>
        )}
      </Spin>
    </Card>
  );
};