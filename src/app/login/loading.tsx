'use client';

import React from 'react';
import { Spin, Card, Typography } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useCommonTranslation } from '@/hooks/useTranslation';
import styles from './login.module.css';

const { Title, Text } = Typography;

const LoginLoading: React.FC = () => {
  const { getCompanyInfo, isLoading } = useSystemSettings();
  const { t } = useCommonTranslation();
  const companyInfo = getCompanyInfo();
  
  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginWrapper}>
        {/* 브랜딩 섹션 - 로딩 중에도 표시 */}
        <div className={styles.brandingSection}>
          <Card className={styles.brandingCard} variant="borderless">
            <div className={styles.brandingContent}>
              <div className={styles.logoSection}>
                <div className={styles.logo}>
                  <LoadingOutlined className={styles.logoIcon} spin />
                </div>
                <Title level={2} className={styles.brandTitle}>
                  {isLoading ? 'Loading...' : companyInfo.name}
                </Title>
                <Text className={styles.subtitle}>
                  {t('app.monitoringSystem')}
                </Text>
              </div>
              
              <div style={{ textAlign: 'center', marginTop: 48 }}>
                <Spin 
                  indicator={<LoadingOutlined style={{ fontSize: 24, color: 'white' }} spin />} 
                />
                <div style={{ marginTop: 16 }}>
                  <Text style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '14px' }}>
                    {t('auth.preparingLoginPage')}
                  </Text>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* 로딩 섹션 */}
        <div className={styles.loginSection}>
          <div className={styles.loginFormWrapper} style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 32 }}>
              <Spin size="large" />
            </div>
            <Title level={3} style={{ marginBottom: 16 }}>
              {t('app.loading')}
            </Title>
            <Text type="secondary">
              {t('auth.pleaseWait')}
            </Text>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginLoading;