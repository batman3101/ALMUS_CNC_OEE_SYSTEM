'use client';

import React, { useState } from 'react';
import { theme } from 'antd';
import { 
  Drawer, 
  List, 
  Typography, 
  Button, 
  Space, 
  Tag, 
  Empty, 
  Divider,
  Tooltip,
  Badge,
  Dropdown,
  MenuProps
} from 'antd';
import { 
  CloseOutlined, 
  CheckOutlined, 
  DeleteOutlined,
  FilterOutlined,
  MoreOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons';
import { Notification, NotificationSeverity, NotificationStatus } from '@/types/notifications';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatDistanceToNow } from 'date-fns';
import { ko, vi } from 'date-fns/locale';

const { Text, Title } = Typography;

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
  notifications: Notification[];
  onAcknowledge: (id: string) => Promise<void>;
  onResolve: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClearAll: () => Promise<void>;
  loading?: boolean;
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({
  open,
  onClose,
  notifications,
  onAcknowledge,
  onResolve,
  onDelete,
  onClearAll,
  loading = false
}) => {
  const { token } = theme.useToken();
  const { t, language } = useLanguage();
  // ✅ 기본 필터를 'active'로 변경 (확인된 알림은 기본적으로 숨김)
  const [filter, setFilter] = useState<NotificationStatus | 'all'>('active');
  const [severityFilter, setSeverityFilter] = useState<NotificationSeverity | 'all'>('all');

  // 필터링된 알림 목록
  const filteredNotifications = notifications.filter(notification => {
    const statusMatch = filter === 'all' || notification.status === filter;
    const severityMatch = severityFilter === 'all' || notification.severity === severityFilter;
    return statusMatch && severityMatch;
  });

  // 심각도별 아이콘
  const getSeverityIcon = (severity: NotificationSeverity | string) => {
    switch (severity) {
      case 'critical':
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      case 'high':
      case 'warning':
        return <ExclamationCircleOutlined style={{ color: '#fa8c16' }} />;
      case 'medium':
        return <WarningOutlined style={{ color: '#faad14' }} />;
      case 'low':
        return <InfoCircleOutlined style={{ color: '#52c41a' }} />;
      case 'info':
        return <InfoCircleOutlined style={{ color: '#1890ff' }} />;
      default:
        return <InfoCircleOutlined />;
    }
  };

  // 심각도별 색상
  const getSeverityColor = (severity: NotificationSeverity | string) => {
    switch (severity) {
      case 'critical':
      case 'error':
        return 'error';
      case 'high':
      case 'warning':
        return 'warning';
      case 'medium':
        return 'orange';
      case 'low':
        return 'success';
      case 'info':
        return 'blue';
      default:
        return 'default';
    }
  };

  // 상태별 색상
  const getStatusColor = (status: NotificationStatus) => {
    switch (status) {
      case 'active':
        return 'red';
      case 'acknowledged':
        return 'orange';
      case 'resolved':
        return 'green';
      default:
        return 'default';
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

  // 필터 메뉴 아이템
  const filterItems: MenuProps['items'] = [
    {
      key: 'all',
      label: t('notifications.filter.all'),
      onClick: () => setFilter('all')
    },
    {
      key: 'active',
      label: t('notifications.filter.active'),
      onClick: () => setFilter('active')
    },
    {
      key: 'acknowledged',
      label: t('notifications.filter.acknowledged'),
      onClick: () => setFilter('acknowledged')
    },
    {
      key: 'resolved',
      label: t('notifications.filter.resolved'),
      onClick: () => setFilter('resolved')
    }
  ];

  const severityFilterItems: MenuProps['items'] = [
    {
      key: 'all',
      label: t('notifications.severity.all'),
      onClick: () => setSeverityFilter('all')
    },
    {
      key: 'critical',
      label: t('notifications.severity.critical'),
      onClick: () => setSeverityFilter('critical')
    },
    {
      key: 'high',
      label: t('notifications.severity.high'),
      onClick: () => setSeverityFilter('high')
    },
    {
      key: 'medium',
      label: t('notifications.severity.medium'),
      onClick: () => setSeverityFilter('medium')
    },
    {
      key: 'low',
      label: t('notifications.severity.low'),
      onClick: () => setSeverityFilter('low')
    },
    {
      key: 'info',
      label: t('notifications.severity.info'),
      onClick: () => setSeverityFilter('info')
    }
  ];

  // 알림 액션 메뉴
  const getNotificationActions = (notification: Notification): MenuProps['items'] => [
    ...(notification.status === 'active' ? [{
      key: 'acknowledge',
      label: t('notifications.actions.acknowledge'),
      icon: <CheckOutlined />,
      onClick: () => onAcknowledge(notification.id)
    }] : []),
    ...(notification.status !== 'resolved' ? [{
      key: 'resolve',
      label: t('notifications.actions.resolve'),
      icon: <CheckOutlined />,
      onClick: () => onResolve(notification.id)
    }] : []),
    {
      key: 'delete',
      label: t('notifications.actions.delete'),
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => onDelete(notification.id)
    }
  ];

  const isDarkMode = (typeof window !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark');

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level={4} style={{ margin: 0 }}>
            {t('notifications.title')}
            <Badge 
              count={notifications.filter(n => n.status === 'active').length} 
              style={{ marginLeft: 8 }}
            />
          </Title>
          <Space>
            <Dropdown menu={{ items: filterItems }} placement="bottomRight">
              <Button size="small" icon={<FilterOutlined />}>
                {t('notifications.filter.label')}
              </Button>
            </Dropdown>
            <Dropdown menu={{ items: severityFilterItems }} placement="bottomRight">
              <Button size="small">
                {t('notifications.severity.label')}
              </Button>
            </Dropdown>
          </Space>
        </div>
      }
      placement="right"
      onClose={onClose}
      open={open}
      width={400}
      styles={{
        body: {
          background: isDarkMode ? token.colorBgElevated : undefined
        },
        header: {
          background: isDarkMode ? token.colorBgElevated : undefined
        }
      }}
      extra={
        <Space>
          {notifications.length > 0 && (
            <Button 
              size="small" 
              onClick={onClearAll}
              loading={loading}
            >
              {t('notifications.actions.clearAll')}
            </Button>
          )}
          <Button 
            type="text" 
            icon={<CloseOutlined />} 
            onClick={onClose}
            size="small"
          />
        </Space>
      }
    >
      {filteredNotifications.length === 0 ? (
        <Empty 
          description={t('notifications.empty')}
          style={{ marginTop: 60 }}
        />
      ) : (
        <List
          dataSource={filteredNotifications}
          renderItem={(notification) => (
            <List.Item
              style={{
                padding: '12px 0',
                borderLeft: `4px solid ${
                  notification.severity === 'critical' ? '#ff4d4f' :
                  notification.severity === 'high' ? '#fa8c16' :
                  notification.severity === 'medium' ? '#faad14' : '#52c41a'
                }`,
                paddingLeft: 12,
                marginLeft: -12,
                backgroundColor: notification.status === 'active'
                  ? (isDarkMode ? '#2a1919' : '#fff2f0')
                  : 'transparent'
              }}
              actions={[
                <Dropdown 
                  key="actions"
                  menu={{ items: getNotificationActions(notification) }}
                  placement="bottomRight"
                >
                  <Button 
                    type="text" 
                    icon={<MoreOutlined />} 
                    size="small"
                  />
                </Dropdown>
              ]}
            >
              <List.Item.Meta
                avatar={getSeverityIcon(notification.severity)}
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <Text strong style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {notification.title}
                    </Text>
                    <Space size={4} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                      <Tag
                        color={getSeverityColor(notification.severity)}
                        size="small"
                      >
                        {t(`notifications.severity.${notification.severity}`)}
                      </Tag>
                      <Tag
                        color={getStatusColor(notification.status)}
                        size="small"
                      >
                        {t(`notifications.status.${notification.status}`)}
                      </Tag>
                    </Space>
                  </div>
                }
                description={
                  <div>
                    <Text style={{ fontSize: 13, color: '#666' }}>
                      {notification.message}
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {notification.machine_name} • {formatTime(notification.created_at)}
                      </Text>
                    </div>
                    {notification.current_value !== undefined && notification.threshold_value !== undefined && (
                      <div style={{ marginTop: 4 }}>
                        <Text style={{ fontSize: 12 }}>
                          {t('notifications.currentValue')}: {notification.current_value} / 
                          {t('notifications.threshold')}: {notification.threshold_value}
                        </Text>
                      </div>
                    )}
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Drawer>
  );
};