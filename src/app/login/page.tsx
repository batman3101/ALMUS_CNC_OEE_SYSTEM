'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Card, Typography } from 'antd';
import { SettingOutlined, BarChartOutlined, DashboardOutlined } from '@ant-design/icons';
import { LoginFormInline } from '@/components/auth/LoginFormInline';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useTranslation } from 'react-i18next';
import styles from './login.module.css';

// 클라이언트 전용 컴포넌트
const ThemeToggle = dynamic(() => import('@/components/layout/ThemeToggle'), { ssr: false });
const LanguageToggle = dynamic(() => import('@/components/layout/LanguageToggle'), { ssr: false });

const { Title, Text, Paragraph } = Typography;

const LoginPage: React.FC = () => {
  const router = useRouter();
  const { t } = useTranslation(['auth', 'common']);
  const { getCompanyInfo, isLoading } = useSystemSettings();
  const companyInfo = getCompanyInfo();

  const handleLoginSuccess = () => {
    router.push('/dashboard');
  };

  return (
    <div className={styles.loginContainer}>
      {/* 테마 및 언어 토글 */}
      <div className={styles.loginControls}>
        <ThemeToggle size="middle" showTooltip={false} />
        <LanguageToggle size="middle" showText={true} />
      </div>

      <div className={styles.loginWrapper}>
        {/* 좌측 브랜딩 영역 */}
        <div className={styles.brandingSection}>
          <Card className={styles.brandingCard} variant="filled">
            <div className={styles.brandingContent}>
              <div className={styles.logoSection}>
                <div className={styles.logo}>
                  <Image
                    src="/symbol.svg"
                    alt="Company Logo"
                    width={64}
                    height={64}
                    style={{
                      width: '60px',
                      height: '60px',
                      objectFit: 'contain',
                      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
                    }}
                  />
                </div>
                <Title level={2} className={styles.brandTitle}>
                  {isLoading ? 'Loading...' : companyInfo.name}
                </Title>
                <Text className={styles.subtitle}>
                  CNC OEE System
                </Text>
              </div>

              <div className={styles.featuresSection}>
                <Title level={4} className={styles.featuresTitle}>
                  {t('auth:loginPage.systemFeatures')}
                </Title>

                <div className={styles.featureList}>
                  <div className={styles.featureItem}>
                    <DashboardOutlined className={styles.featureIcon} />
                    <div>
                      <Text strong style={{ color: 'white' }}>{t('auth:loginPage.realtimeMonitoring')}</Text>
                      <br />
                      <Text className={styles.featureDesc} style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                        {t('auth:loginPage.realtimeMonitoringDesc')}
                      </Text>
                    </div>
                  </div>

                  <div className={styles.featureItem}>
                    <BarChartOutlined className={styles.featureIcon} />
                    <div>
                      <Text strong style={{ color: 'white' }}>{t('auth:loginPage.oeeAnalysis')}</Text>
                      <br />
                      <Text className={styles.featureDesc} style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                        {t('auth:loginPage.oeeAnalysisDesc')}
                      </Text>
                    </div>
                  </div>

                  <div className={styles.featureItem}>
                    <SettingOutlined className={styles.featureIcon} />
                    <div>
                      <Text strong style={{ color: 'white' }}>{t('auth:loginPage.integratedManagement')}</Text>
                      <br />
                      <Text className={styles.featureDesc} style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                        {t('auth:loginPage.integratedManagementDesc')}
                      </Text>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.systemInfo}>
                <Text className={styles.versionInfo} style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                  {t('auth:loginPage.version')}
                </Text>
              </div>
            </div>
          </Card>
        </div>

        {/* 우측 로그인 폼 영역 */}
        <div className={styles.loginSection}>
          <div className={styles.loginFormWrapper}>
            <div className={styles.loginHeader}>
              <Title level={2} className={styles.loginTitle}>
                {t('auth:loginPage.systemLogin')}
              </Title>
              <Paragraph className={styles.loginDesc}>
                {isLoading ? t('common:app.loading') : t('auth:loginPage.loginToSystem', { companyName: companyInfo.name })}
              </Paragraph>
            </div>

            <LoginFormInline onSuccess={handleLoginSuccess} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;