'use client';

import React from 'react';
import { Badge, Button } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { NotificationSeverity } from '@/types/notifications';

interface NotificationBadgeProps {
  count: number;
  maxCount?: number;
  severity?: NotificationSeverity;
  onClick?: () => void;
  size?: 'small' | 'default';
}

export const NotificationBadge: React.FC<NotificationBadgeProps> = ({
  count,
  maxCount = 99,
  severity = 'medium',
  onClick,
  size = 'default'
}) => {
  const getBadgeColor = (severity: NotificationSeverity) => {
    switch (severity) {
      case 'critical':
        return '#ff4d4f';
      case 'high':
        return '#fa8c16';
      case 'medium':
        return '#faad14';
      case 'low':
        return '#52c41a';
      default:
        return '#1890ff';
    }
  };

  return (
    <Badge 
      count={count} 
      overflowCount={maxCount}
      color={getBadgeColor(severity)}
      size={size}
    >
      <Button
        type="text"
        icon={<BellOutlined />}
        onClick={onClick}
        size={size}
        style={{
          color: count > 0 ? getBadgeColor(severity) : undefined
        }}
      />
    </Badge>
  );
};