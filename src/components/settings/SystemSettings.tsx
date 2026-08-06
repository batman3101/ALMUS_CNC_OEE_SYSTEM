'use client';

import React, { useCallback, useState } from 'react';
import {
  Tabs,
  Card,
  Spin,
  Alert,
  Button,
  Space,
  App,
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
import { useMessage } from '@/hooks/useMessage';
import GeneralSettingsTab from './tabs/GeneralSettingsTab';
import OEESettingsTab from './tabs/OEESettingsTab';
import ShiftSettingsTab from './tabs/ShiftSettingsTab';
import NotificationSettingsTab from './tabs/NotificationSettingsTab';
import DisplaySettingsTab from './tabs/DisplaySettingsTab';
import SettingsAuditTab from './tabs/SettingsAuditTab';
import { useFailureReport } from '@/hooks/useFailureReport';

const { Title, Text } = Typography;

const SystemSettings: React.FC = () => {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  /**
   * 정적 `Modal.confirm` 이 아니라 App 컨텍스트의 modal 을 쓴다.
   *
   * 정적 함수는 React 컨텍스트를 읽지 못해 AntdConfigProvider 의 다크 테마를 적용받지
   * 못한다 — 어두운 화면 위에 흰 다이얼로그가 떴다. antd 도 이걸 콘솔 경고로 알려주고
   * 있었지만(`[antd: Modal] Static function can not consume context...`) 아무도 못 봤다.
   * **미저장 감지가 반대로 동작하던 동안 이 다이얼로그가 뜰 일이 사실상 없었기 때문이다.**
   * 경고를 고치자 다이얼로그가 실제로 뜨기 시작했고, 그제야 흰 모달이 드러났다.
   * 실행되지 않는 경로는 눈에도 테스트에도 닿지 않은 채 조용히 썩는다.
   */
  const { modal } = App.useApp();
  const confirm = modal.confirm;
  // 실패 보고는 전부 reportFailure 로 나갔다 — 여기 남은 건 성공 안내뿐이다.
  const { success: showSuccess, contextHolder } = useMessage();
  const reportFailure = useFailureReport();
  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    settings,
    isLoading,
    error,
    refreshSettings,
    resetAllSettings,
    lastUpdated
  } = useSystemSettings();
  
  const [activeTab, setActiveTab] = useState('general');

  /**
   * 미저장 여부는 **탭마다 따로** 센다.
   *
   * antd 의 Tabs 는 한 번 연 탭을 언마운트하지 않는다(기본값). 그래서 전역 boolean 하나를
   * 다섯 탭이 공유하면, 일반 탭을 편집해 dirty 가 켜진 상태에서 화면 탭을 저장하는 순간
   * 그 해제가 일반 탭의 편집까지 지워 버린다. 편집은 탭별로 독립이므로 상태도 탭별이어야 한다.
   */
  const [dirtyTabs, setDirtyTabs] = useState<Record<string, boolean>>({});
  const hasUnsavedChanges = Object.values(dirtyTabs).some(Boolean);

  const makeDirtyHandler = useCallback(
    (tabKey: string) => (dirty: boolean) =>
      setDirtyTabs(previous => (previous[tabKey] === dirty
        ? previous                                   // 같은 값이면 리렌더를 만들지 않는다
        : { ...previous, [tabKey]: dirty })),
    [],
  );

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
          onDirtyChange={makeDirtyHandler('general')}
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
          onDirtyChange={makeDirtyHandler('oee')}
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
          onDirtyChange={makeDirtyHandler('shift')}
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
          onDirtyChange={makeDirtyHandler('notification')}
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
          onDirtyChange={makeDirtyHandler('display')}
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
      showSuccess(t('settings.refreshSuccess'));
      setDirtyTabs({});
    } catch (error) {
      console.error('Error refreshing settings:', error);
      reportFailure(t('settings.refreshError'), error);
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
            showSuccess(t('settings.resetAllSuccess'));
            setDirtyTabs({});
          } else {
            reportFailure(t('settings.resetAllError'));
          }
        } catch (error) {
          console.error('Error resetting all settings:', error);
          reportFailure(t('settings.resetAllError'), error);
        }
      },
    });
  };

  // 탭 변경 시 미저장 변경사항 확인
  //
  // **지금 떠나는 탭**이 dirty 일 때만 묻는다. 다른 탭이 dirty 하다는 이유로 깨끗한 탭을
  // 옮길 때마다 물으면 경고가 잡음이 되고, 잡음이 된 경고는 읽히지 않는다.
  const handleTabChange = (key: string) => {
    if (dirtyTabs[activeTab]) {
      const leavingTab = activeTab;
      confirm({
        title: t('settings.unsavedChangesTitle'),
        content: t('settings.unsavedChangesContent'),
        icon: <ExclamationCircleOutlined />,
        okText: t('common.continue'),
        cancelText: t('common.cancel'),
        onOk: () => {
          setActiveTab(key);
          // 떠난 탭의 편집을 "포기"로 확정한다. 탭은 언마운트되지 않으므로 폼에는 편집 내용이
          // 그대로 남지만, 관리자가 버리겠다고 답한 이상 미저장 배지는 그 탭을 더 세지 않는다.
          setDirtyTabs(previous => ({ ...previous, [leavingTab]: false }));
        },
      });
    } else {
      setActiveTab(key);
    }
  };

  // 권한 없음 메시지
  if (!isAdmin) {
    return (
      <div>
        {contextHolder}
        <Alert
          message={t('settings.accessDenied')}
          description={t('settings.adminRequired')}
          type="warning"
          showIcon
        />
      </div>
    );
  }

  return (
    <div>
      {contextHolder}
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
              {/* 로케일을 명시하지 않으면 브라우저 기본값(한국어 환경이면 '2026. 7. 14. 오전 8:36')이 나온다 */}
              {/*
                이 시각은 **설정을 마지막으로 읽어온 때**이지 DB 가 마지막으로 바뀐 때가 아니다.
                SystemSettingsContext 가 로드 성공 시 `new Date()` 를 찍는다. 예전 라벨은
                "마지막 업데이트"였는데, 그러면 새로고침만 눌러도 시각이 갱신돼 아무도 설정을
                바꾸지 않았는데 방금 바뀐 것처럼 보였다. 라벨이 데이터를 따라가야 한다.
              */}
              {t('settings.lastLoaded')}: {lastUpdated.toLocaleString(language === 'vi' ? 'vi-VN' : 'ko-KR')}
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