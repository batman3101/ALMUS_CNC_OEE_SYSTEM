'use client';

import React, { useState, useEffect } from 'react';
import { Card, Alert, Button, Space, Typography, Collapse, Tag } from 'antd';
import { ReloadOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { systemSettingsService } from '@/lib/systemSettings';
import { supabase } from '@/lib/supabase';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;

/**
 * 시스템 설정 디버그 컴포넌트
 * 개발 환경에서 설정 상태를 확인하고 문제를 진단
 */
const SystemSettingsDebug: React.FC = () => {
  const [status, setStatus] = useState<{
    tableExists: boolean;
    hasData: boolean;
    settingsCount: number;
    error: string | null;
    loading: boolean;
  }>({
    tableExists: false,
    hasData: false,
    settingsCount: 0,
    error: null,
    loading: true
  });

  const checkSystemSettings = async () => {
    setStatus(prev => ({ ...prev, loading: true, error: null }));

    try {
      // 1. 테이블 존재 여부 확인
      const { data: tables, error: tableError } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public')
        .eq('table_name', 'system_settings');

      const tableExists = !tableError && tables && tables.length > 0;

      if (!tableExists) {
        setStatus({
          tableExists: false,
          hasData: false,
          settingsCount: 0,
          error: 'system_settings 테이블이 존재하지 않습니다',
          loading: false
        });
        return;
      }

      // 2. 데이터 존재 여부 확인
      const response = await systemSettingsService.getAllSettings();
      
      if (response.success && response.data) {
        setStatus({
          tableExists: true,
          hasData: response.data.length > 0,
          settingsCount: response.data.length,
          error: null,
          loading: false
        });
      } else {
        setStatus({
          tableExists: true,
          hasData: false,
          settingsCount: 0,
          error: response.error || '설정 데이터를 불러올 수 없습니다',
          loading: false
        });
      }
    } catch (error) {
      console.error('Error checking system settings:', error);
      setStatus({
        tableExists: false,
        hasData: false,
        settingsCount: 0,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
        loading: false
      });
    }
  };

  const initializeSettings = async () => {
    try {
      setStatus(prev => ({ ...prev, loading: true }));
      
      // 기본 설정 데이터 생성 시도
      const response = await systemSettingsService.getAllSettings();
      
      if (response.success) {
        await checkSystemSettings();
      } else {
        setStatus(prev => ({ 
          ...prev, 
          error: '설정 초기화에 실패했습니다: ' + response.error,
          loading: false 
        }));
      }
    } catch (error) {
      console.error('Error initializing settings:', error);
      setStatus(prev => ({ 
        ...prev, 
        error: '설정 초기화 중 오류가 발생했습니다',
        loading: false 
      }));
    }
  };

  useEffect(() => {
    checkSystemSettings();
  }, []);

  const getStatusIcon = () => {
    if (status.loading) return null;
    if (status.tableExists && status.hasData) return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
    return <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />;
  };

  const getStatusMessage = () => {
    if (status.loading) return '시스템 설정 상태를 확인하는 중...';
    if (!status.tableExists) return 'system_settings 테이블이 존재하지 않습니다';
    if (!status.hasData) return '시스템 설정 데이터가 없습니다';
    return `시스템 설정이 정상적으로 로드되었습니다 (${status.settingsCount}개 설정)`;
  };

  const getStatusType = (): 'success' | 'warning' | 'error' | 'info' => {
    if (status.loading) return 'info';
    if (status.tableExists && status.hasData) return 'success';
    if (status.tableExists && !status.hasData) return 'warning';
    return 'error';
  };

  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <Title level={2}>시스템 설정 디버그</Title>
      
      <Alert
        message={getStatusMessage()}
        description={status.error}
        type={getStatusType()}
        icon={getStatusIcon()}
        showIcon
        style={{ marginBottom: '24px' }}
      />

      <Space style={{ marginBottom: '24px' }}>
        <Button 
          icon={<ReloadOutlined />} 
          onClick={checkSystemSettings}
          loading={status.loading}
        >
          상태 다시 확인
        </Button>
        
        {!status.hasData && (
          <Button 
            type="primary"
            onClick={initializeSettings}
            loading={status.loading}
          >
            기본 설정 초기화
          </Button>
        )}
      </Space>

      <Collapse>
        <Panel header="해결 방법" key="solutions">
          <div>
            <Title level={4}>1. 데이터베이스 마이그레이션 실행</Title>
            <Paragraph>
              Supabase 대시보드의 SQL Editor에서 다음 스크립트를 실행하세요:
            </Paragraph>
            <Paragraph>
              <Text code>/scripts/init-system-settings.sql</Text>
            </Paragraph>

            <Title level={4}>2. 수동 테이블 생성</Title>
            <Paragraph>
              다음 SQL을 Supabase SQL Editor에서 실행하세요:
            </Paragraph>
            <Paragraph>
              <Text code style={{ whiteSpace: 'pre-wrap' }}>
{`CREATE TABLE system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(50) NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  setting_value JSONB NOT NULL,
  value_type VARCHAR(20) NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(category, setting_key)
);`}
              </Text>
            </Paragraph>

            <Title level={4}>3. 권한 확인</Title>
            <Paragraph>
              현재 사용자가 <Tag color="blue">authenticated</Tag> 역할을 가지고 있는지 확인하세요.
            </Paragraph>
          </div>
        </Panel>

        <Panel header="현재 상태" key="status">
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Text strong>테이블 존재: </Text>
              <Tag color={status.tableExists ? 'green' : 'red'}>
                {status.tableExists ? '존재함' : '존재하지 않음'}
              </Tag>
            </div>
            <div>
              <Text strong>데이터 존재: </Text>
              <Tag color={status.hasData ? 'green' : 'orange'}>
                {status.hasData ? '존재함' : '존재하지 않음'}
              </Tag>
            </div>
            <div>
              <Text strong>설정 개수: </Text>
              <Tag color="blue">{status.settingsCount}개</Tag>
            </div>
            {status.error && (
              <div>
                <Text strong>오류: </Text>
                <Text type="danger">{status.error}</Text>
              </div>
            )}
          </Space>
        </Panel>
      </Collapse>
    </div>
  );
};

export default SystemSettingsDebug;