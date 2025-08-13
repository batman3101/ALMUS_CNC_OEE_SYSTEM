'use client';

import React from 'react';
import { Select, Space, Typography, Card } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { useAuth } from '@/contexts/AuthContext';
import { MockAuthService, isDevelopment } from '@/lib/mockAuth';
import { User } from '@/types';

const { Text } = Typography;

interface RoleSwitcherProps {
  onRoleChange?: (role: string) => void;
}

export const RoleSwitcher: React.FC<RoleSwitcherProps> = ({ onRoleChange }) => {
  const { user } = useAuth();

  // 개발 환경에서만 표시
  if (!isDevelopment() || !user) {
    return null;
  }

  const handleRoleSwitch = async (newRole: string) => {
    try {
      // 해당 역할의 테스트 계정으로 전환
      await MockAuthService.switchToRole(newRole as 'admin' | 'operator' | 'engineer');
      
      // 페이지 새로고침하여 새로운 역할로 대시보드 로드
      window.location.reload();
      
      onRoleChange?.(newRole);
    } catch (error) {
      console.error('역할 전환 실패:', error);
    }
  };

  return (
    <Card 
      size="small" 
      style={{ 
        position: 'fixed',
        top: 80,
        right: 20,
        zIndex: 1000,
        minWidth: 200,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        border: '2px solid #1890ff'
      }}
    >
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserOutlined style={{ color: '#1890ff' }} />
          <Text strong style={{ fontSize: '12px', color: '#1890ff' }}>
            🔧 개발 모드
          </Text>
        </div>
        
        <div>
          <Text style={{ fontSize: '11px', color: '#666' }}>현재 역할:</Text>
          <br />
          <Text strong style={{ fontSize: '12px' }}>
            {user.role === 'admin' ? '관리자' : 
             user.role === 'engineer' ? '엔지니어' : '운영자'} ({user.name})
          </Text>
        </div>

        <div>
          <Text style={{ fontSize: '11px', color: '#666' }}>역할 전환:</Text>
          <Select
            size="small"
            value={user.role}
            onChange={handleRoleSwitch}
            style={{ width: '100%', marginTop: 4 }}
            options={[
              { label: '👨‍💼 관리자', value: 'admin' },
              { label: '👨‍🔧 운영자', value: 'operator' },
              { label: '👨‍💻 엔지니어', value: 'engineer' }
            ]}
          />
        </div>

        <Text style={{ fontSize: '10px', color: '#999', textAlign: 'center' }}>
          역할 전환 시 페이지가 새로고침됩니다
        </Text>
      </Space>
    </Card>
  );
};