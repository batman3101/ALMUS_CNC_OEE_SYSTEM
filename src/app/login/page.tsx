'use client';

import React from 'react';
import { Card, Typography } from 'antd';
import { SettingOutlined, BarChartOutlined, DashboardOutlined } from '@ant-design/icons';
import { LoginFormInline } from '@/components/auth/LoginFormInline';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useRouter } from 'next/navigation';
import styles from './login.module.css';

const { Title, Text, Paragraph } = Typography;

const LoginPage: React.FC = () => {
  const router = useRouter();
  const { getCompanyInfo, isLoading } = useSystemSettings();
  const companyInfo = getCompanyInfo();

  const handleLoginSuccess = () => {
    router.push('/dashboard');
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginWrapper}>
        {/* 좌측 브랜딩 영역 */}
        <div className={styles.brandingSection}>
          <Card className={styles.brandingCard} variant="filled">
            <div className={styles.brandingContent}>
              <div className={styles.logoSection}>
                <div className={styles.logo}>
                  <SettingOutlined className={styles.logoIcon} />
                </div>
                <Title level={2} className={styles.brandTitle}>
                  {isLoading ? 'Loading...' : companyInfo.name}
                </Title>
                <Text className={styles.subtitle}>
                  모니터링 시스템
                </Text>
              </div>

              <div className={styles.featuresSection}>
                <Title level={4} className={styles.featuresTitle}>
                  시스템 특징
                </Title>
                
                <div className={styles.featureList}>
                  <div className={styles.featureItem}>
                    <DashboardOutlined className={styles.featureIcon} />
                    <div>
                      <Text strong style={{ color: 'white' }}>실시간 모니터링</Text>
                      <br />
                      <Text className={styles.featureDesc} style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                        CNC 설비 상태를 실시간으로 추적
                      </Text>
                    </div>
                  </div>
                  
                  <div className={styles.featureItem}>
                    <BarChartOutlined className={styles.featureIcon} />
                    <div>
                      <Text strong style={{ color: 'white' }}>OEE 분석</Text>
                      <br />
                      <Text className={styles.featureDesc} style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                        생산성 지표 분석 및 개선점 도출
                      </Text>
                    </div>
                  </div>
                  
                  <div className={styles.featureItem}>
                    <SettingOutlined className={styles.featureIcon} />
                    <div>
                      <Text strong style={{ color: 'white' }}>통합 관리</Text>
                      <br />
                      <Text className={styles.featureDesc} style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                        설비, 생산, 품질 데이터 통합 관리
                      </Text>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.systemInfo}>
                <Text className={styles.versionInfo} style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                  Version 1.0.0 | 2024 {isLoading ? 'System' : companyInfo.name} System
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
                시스템 로그인
              </Title>
              <Paragraph className={styles.loginDesc}>
                {isLoading ? 'Loading...' : `${companyInfo.name} 모니터링 시스템에 로그인하세요`}
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