'use client';

import React from 'react';
import { Spin, Card, Typography } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import styles from './login.module.css';

const { Title, Text } = Typography;

const LoginLoading: React.FC = () => {
  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginWrapper}>
        {/* 브랜딩 섹션 - 로딩 중에도 표시 */}
        <div className={styles.brandingSection}>
          <Card className={styles.brandingCard} variant="filled">
            <div className={styles.brandingContent}>
              <div className={styles.logoSection}>
                <div className={styles.logo}>
                  <LoadingOutlined className={styles.logoIcon} spin />
                </div>
                <Title level={2} className={styles.brandTitle}>
                  CNC OEE
                </Title>
                <Text className={styles.subtitle}>
                  모니터링 시스템
                </Text>
              </div>
              
              <div style={{ textAlign: 'center', marginTop: 48 }}>
                <Spin 
                  indicator={<LoadingOutlined style={{ fontSize: 24, color: 'white' }} spin />} 
                />
                <div style={{ marginTop: 16 }}>
                  <Text style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '14px' }}>
                    로그인 페이지를 준비하는 중...
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
              로딩 중...
            </Title>
            <Text type="secondary">
              잠시만 기다려주세요
            </Text>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginLoading;