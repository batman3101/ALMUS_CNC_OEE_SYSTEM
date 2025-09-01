'use client';

import React, { useState, useEffect } from 'react';
import { Typography, Space, Button, Tooltip, Tag } from 'antd';
import { ReloadOutlined, PlayCircleOutlined, PauseCircleOutlined } from '@ant-design/icons';
import { useMachinesTranslation, useCommonTranslation } from '@/hooks/useTranslation';
import MachineList from '@/components/machines/MachineList';
import MachineDetailModal from '@/components/machines/MachineDetailModal';
import { ProtectedRoute } from '@/components/auth';
import { useMachines } from '@/hooks/useMachines';
import { Machine } from '@/types';

const { Title, Paragraph } = Typography;

export default function MachinesPage() {
  const { t } = useMachinesTranslation();
  const { t: tCommon } = useCommonTranslation();
  
  const { 
    machines, 
    loading, 
    error, 
    isAutoRefreshing,
    isRealtimeConnected,
    lastUpdated,
    refetch,
    toggleAutoRefresh
  } = useMachines({
    enableAutoRefresh: true,
    refreshInterval: 30, // 30초 간격
    enableRealtime: true // Realtime 활성화
  });
  
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);

  const handleMachineClick = (machine: Machine) => {
    setSelectedMachine(machine);
    setDetailModalVisible(true);
  };

  const handleDetailModalClose = () => {
    setDetailModalVisible(false);
    setSelectedMachine(null);
  };

  const handleMachineUpdated = () => {
    refetch(); // 설비 목록 새로고침
  };

  // 마지막 업데이트 시간 포맷팅
  const formatLastUpdated = (date: Date | null) => {
    if (!date) return '업데이트 없음';
    
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diff < 60) return `${diff}초 전`;
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    return date.toLocaleTimeString('ko-KR');
  };

  return (
    <ProtectedRoute>
      <div>
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <Title level={2} style={{ marginBottom: '8px' }}>
                {tCommon('nav.machines')}
              </Title>
              <Paragraph type="secondary">
                {t('description')}
              </Paragraph>
            </div>
            
            {/* 실시간 업데이트 제어 패널 */}
            <div>
              <Space direction="vertical" align="end">
                <Space>
                  <Tooltip title={isAutoRefreshing ? "자동 새로고침 중지" : "자동 새로고침 시작"}>
                    <Button
                      type={isAutoRefreshing ? "primary" : "default"}
                      icon={isAutoRefreshing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                      onClick={toggleAutoRefresh}
                    >
                      {isAutoRefreshing ? "자동 새로고침 중" : "자동 새로고침"}
                    </Button>
                  </Tooltip>
                  
                  <Tooltip title="수동 새로고침">
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={() => refetch()}
                      loading={loading}
                    >
                      새로고침
                    </Button>
                  </Tooltip>
                </Space>
                
                <div style={{ textAlign: 'right' }}>
                  <Space>
                    <Tag color={isAutoRefreshing ? "green" : "default"}>
                      {isAutoRefreshing ? "폴링 활성" : "폴링 중지"}
                    </Tag>
                    <Tag color={isRealtimeConnected ? "blue" : "default"}>
                      {isRealtimeConnected ? "실시간 연결" : "실시간 끊김"}
                    </Tag>
                  </Space>
                  <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                    마지막 업데이트: {formatLastUpdated(lastUpdated)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#ccc', marginTop: '2px' }}>
                    {isRealtimeConnected && isAutoRefreshing ? "하이브리드 모드 (폴링 + 실시간)" :
                     isRealtimeConnected ? "실시간 모드" :
                     isAutoRefreshing ? "폴링 모드" : "수동 모드"}
                  </div>
                </div>
              </Space>
            </div>
          </div>
        </div>

        <MachineList 
          machines={machines}
          loading={loading}
          onMachineClick={handleMachineClick}
        />

        {/* 설비 상세 정보 모달 */}
        <MachineDetailModal
          machine={selectedMachine}
          visible={detailModalVisible}
          onClose={handleDetailModalClose}
          onMachineUpdated={handleMachineUpdated}
        />
      </div>
    </ProtectedRoute>
  );
}