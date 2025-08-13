'use client';

import React, { useState, useEffect } from 'react';
import { 
  Tabs, 
  Card, 
  Spin, 
  Alert, 
  Button, 
  Space, 
  Modal, 
  message,
  Typography 
} from 'antd';
import { 
  SettingOutlined,
  GlobalOutlined,
  DashboardOutlined,
  BellOutlined,
  EyeOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import GeneralSettingsTab from './tabs/GeneralSettingsTab';
import OEESettingsTab from './tabs/OEESettingsTab';
import ShiftSettingsTab from './tabs/ShiftSettingsTab';
import NotificationSettingsTab from './tabs/NotificationSettingsTab';
import DisplaySettingsTab from './tabs/DisplaySettingsTab';
import SettingsAuditTab from './tabs/SettingsAuditTab';

const { Title, Text } = Typography;
const { confirm } = Modal;

const SystemSettings: React.FC = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { 
    settings, 
    isLoading, 
    error, 
    refreshSettings, 
    resetAllSettings,
    lastUpdated 
  } = useSystemSettings();
  
  const [activeTab, setActiveTab] = useState('general');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // 관리자 권한 확인
  const isAdmin = user?.role === 'admin';

  // 탭 아이템 정의
  const tabItems = [
    {
      key: 'general',
      label: (
        <span>
          <GlobalOutlined />
          {t('settings.tabs.general')}
        </span>
      ),
      children: (
        <GeneralSettingsTab 
          onSettingsChange={() => setHasUnsavedChanges(true)}
        />
      ),
    },
    {
      key: 'oee',
      label: (
        <span>
          <DashboardOutlined />
          {t('settings.tabs.oee')}
        </span>
      ),
      children: (
        <OEESettingsTab 
          onSettingsChange={() => setHasUnsavedChanges(true)}
        />
      ),
    },
    {
      key: 'shift',
      label: (
        <span>
          <ClockCircleOutlined />
          {t('settings.tabs.shift')}
        </span>
      ),
      children: (
        <ShiftSettingsTab 
          onSettingsChange={() => setHasUnsavedChanges(true)}
        />
      ),
    },
    {
      key: 'notification',
      label: (
        <span>
          <BellOutlined />
          {t('settings.tabs.notification')}
        </span>
      ),
      children: (
        <NotificationSettingsTab 
          onSettingsChange={() => setHasUnsavedChanges(true)}
        />
      ),
    },
    {
      key: 'display',
      label: (
        <span>
          <EyeOutlined />
          {t('settings.tabs.display')}
        </span>
      ),
      children: (
        <DisplaySettingsTab 
          onSettingsChange={() => setHasUnsavedChanges(true)}
        />
      ),
    },
  ];

  // 관리자만 감사 로그 탭 추가
  if (isAdmin) {
    tabItems.push({
      key: 'audit',
      label: (
        <span>
          <SettingOutlined />
          {t('settings.tabs.audit')}
        </span>
      ),
      children: <SettingsAuditTab />,
    });
  }

  // 설정 새로고침
  const handleRefresh = async () => {
    try {
      await refreshSettings();
      message.success(t('settings.refreshSuccess'));
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Error refreshing settings:', error);
      message.error(t('settings.refreshError'));
    }
  };

  // 모든 설정 초기화
  const handleResetAll = () => {
    confirm({
      title: t('settings.resetAllTitle'),
      content: t('settings.resetAllContent'),
      icon: <ExclamationCircleOutlined />,
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okType: 'danger',
      onOk: async () => {
        try {
          const success = await resetAllSettings();
          if (success) {
            message.success(t('settings.resetAllSuccess'));
            setHasUnsavedChanges(false);
          } else {
            message.error(t('settings.resetAllError'));
          }
        } catch (error) {
          console.error('Error resetting all settings:', error);
          message.error(t('settings.resetAllError'));
        }
      },
    });
  };

  // 탭 변경 시 미저장 변경사항 확인
  const handleTabChange = (key: string) => {
    if (hasUnsavedChanges) {
      confirm({
        title: t('settings.unsavedChangesTitle'),
        content: t('settings.unsavedChangesContent'),
        icon: <ExclamationCircleOutlined />,
        okText: t('common.continue'),
        cancelText: t('common.cancel'),
        onOk: () => {
          setActiveTab(key);
          setHasUnsavedChanges(false);
        },
      });
    } else {
      setActiveTab(key);
    }
  };

  // 권한 없음 메시지
  if (!isAdmin) {
    return (
      <Alert
        message={t('settings.accessDenied')}
        description={t('settings.adminRequired')}
        type="warning"
        showIcon
      />
    );
  }

  return (
    <div>
      {/* 헤더 영역 */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '24px' 
      }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            {t('settings.systemSettings')}
          </Title>
          {lastUpdated && (
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {t('settings.lastUpdated')}: {lastUpdated.toLocaleString()}
            </Text>
          )}
        </div>
        
        <Space>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={handleRefresh}
            loading={isLoading}
          >
            {t('common.refresh')}
          </Button>
          <Button 
            danger 
            onClick={handleResetAll}
            disabled={isLoading}
          >
            {t('settings.resetAll')}
          </Button>
        </Space>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <Alert
          message={t('settings.loadError')}
          description={error}
          type="error"
          showIcon
          closable
          style={{ marginBottom: '16px' }}
        />
      )}

      {/* 미저장 변경사항 경고 */}
      {hasUnsavedChanges && (
        <Alert
          message={t('settings.unsavedChanges')}
          description={t('settings.unsavedChangesDesc')}
          type="warning"
          showIcon
          style={{ marginBottom: '16px' }}
        />
      )}

      {/* 설정 탭 */}
      <Card>
        <Spin spinning={isLoading}>
          <Tabs
            activeKey={activeTab}
            onChange={handleTabChange}
            items={tabItems}
            size="large"
            tabPosition="top"
          />
        </Spin>
      </Card>
    </div>
  );
};

export default SystemSettings;