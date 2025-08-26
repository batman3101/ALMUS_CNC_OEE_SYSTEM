'use client';

import React, { useState } from 'react';
import {
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  Space,
  Card,
  Row,
  Col,
  Typography,
  Table,
  Modal,
  Popconfirm,
  Tabs,
  Alert,
  Badge,
  DatePicker,
  Descriptions,
  Divider,
  Checkbox,
  App
} from 'antd';
import {
  SaveOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  SunOutlined,
  MoonOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useMachines } from '@/hooks/useMachines';
import { useUserProfiles } from '@/hooks/useUserProfiles';
import type { ShiftProductionData, DowntimeEntry, DailyProductionData } from '@/types/dataInput';

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;
const { TabPane } = Tabs;

interface ShiftDataInputFormProps {
  initialDate?: string;
}

const ShiftDataInputForm: React.FC<ShiftDataInputFormProps> = ({
  initialDate = dayjs().format('YYYY-MM-DD')
}) => {
  const { t } = useLanguage();
  const { getSetting } = useSystemSettings();
  const { machines, loading: machinesLoading, error: machinesError } = useMachines();
  const { profiles, loading: profilesLoading, error: profilesError } = useUserProfiles();
  const { message } = App.useApp();
  
  // 폼 상태
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [activeShift, setActiveShift] = useState<'DAY' | 'NIGHT'>('DAY');
  const [loading, setLoading] = useState(false);
  
  // 교대조별 기본 가동시간 (분 단위)
  const [dayShiftOperatingMinutes, setDayShiftOperatingMinutes] = useState<number>(720); // 기본 12시간 = 720분
  const [nightShiftOperatingMinutes, setNightShiftOperatingMinutes] = useState<number>(720); // 기본 12시간 = 720분
  
  // 교대조별 휴무 상태
  const [dayShiftOff, setDayShiftOff] = useState<boolean>(false);
  const [nightShiftOff, setNightShiftOff] = useState<boolean>(false);
  
  // 설비 관련 데이터 상태
  const [machineDetails, setMachineDetails] = useState<{
    productionModel: any | null;
    currentProcess: any | null;
    loading: boolean;
    error: string | null;
  }>({
    productionModel: null,
    currentProcess: null,
    loading: false,
    error: null
  });
  
  // 교대별 데이터
  const [dayShiftData, setDayShiftData] = useState<ShiftProductionData>({
    shift: 'DAY',
    shift_name: '주간조',
    start_time: '08:00',
    end_time: '20:00',
    operator_name: '',
    actual_production: 0,
    defect_quantity: 0,
    good_quantity: 0,
    downtime_entries: [],
    total_downtime_minutes: 0
  });
  
  const [nightShiftData, setNightShiftData] = useState<ShiftProductionData>({
    shift: 'NIGHT',
    shift_name: '야간조',
    start_time: '20:00',
    end_time: '08:00',
    operator_name: '',
    actual_production: 0,
    defect_quantity: 0,
    good_quantity: 0,
    downtime_entries: [],
    total_downtime_minutes: 0
  });

  // 비가동 시간 모달 상태
  const [downtimeModalVisible, setDowntimeModalVisible] = useState(false);
  const [downtimeForm] = Form.useForm();

  // 비가동 사유 목록
  const downtimeReasons = getSetting('general', 'downtime_reasons') || [
    '설비 고장', '금형 교체', '자재 부족', '품질 불량', '계획 정지', '청소/정리', '기타'
  ];

  // 현재 교대 데이터 가져오기
  const getCurrentShiftData = (): ShiftProductionData => {
    return activeShift === 'DAY' ? dayShiftData : nightShiftData;
  };

  // 현재 교대 데이터 업데이트
  const updateCurrentShiftData = (updates: Partial<ShiftProductionData>) => {
    if (activeShift === 'DAY') {
      setDayShiftData(prev => ({ ...prev, ...updates }));
    } else {
      setNightShiftData(prev => ({ ...prev, ...updates }));
    }
  };

  // 선택된 설비 정보 가져오기
  const getSelectedMachine = () => {
    return machines.find(m => m.id === selectedMachineId);
  };

  // 설비의 생산 모델 정보 가져오기
  const getMachineProductionModel = async (machineId: string) => {
    const machine = machines.find(m => m.id === machineId);
    if (!machine?.production_model_id) {
      throw new Error('설비에 생산 모델이 설정되어 있지 않습니다.');
    }

    const response = await fetch(`/api/product-models/${machine.production_model_id}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'API request failed');
    }

    return data.model;
  };

  // 설비의 현재 공정 정보 가져오기
  const getMachineCurrentProcess = async (machineId: string) => {
    const machine = machines.find(m => m.id === machineId);
    if (!machine?.current_process_id) {
      throw new Error('설비에 공정이 설정되어 있지 않습니다.');
    }

    const response = await fetch(`/api/model-processes/${machine.current_process_id}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'API request failed');
    }

    return data.process;
  };

  // 기준 생산량(CAPA) 계산 (분 단위 입력)
  const calculateCapacity = (tactTimeSeconds: number, operatingMinutes: number) => {
    if (!tactTimeSeconds || !operatingMinutes) return 0;
    return Math.floor((operatingMinutes * 60) / tactTimeSeconds);
  };

  // 설비 선택 핸들러
  const handleMachineSelect = async (machineId: string) => {
    setSelectedMachineId(machineId);
    
    // 이전 데이터 초기화
    setMachineDetails({
      productionModel: null,
      currentProcess: null,
      loading: false,
      error: null
    });

    // 선택된 설비 정보 확인
    const selectedMachine = machines.find(m => m.id === machineId);
    if (selectedMachine) {
      console.log('Selected machine:', selectedMachine);
      
      // 로딩 시작
      setMachineDetails(prev => ({ ...prev, loading: true, error: null }));
      
      try {
        // 생산 모델 및 공정 정보 가져오기
        const promises = [];
        
        // 생산 모델 정보 가져오기
        if (selectedMachine.production_model_id) {
          promises.push(getMachineProductionModel(machineId));
        } else {
          promises.push(Promise.resolve(null));
        }
        
        // 공정 정보 가져오기
        if (selectedMachine.current_process_id) {
          promises.push(getMachineCurrentProcess(machineId));
        } else {
          promises.push(Promise.resolve(null));
        }

        const [productionModel, currentProcess] = await Promise.all(promises);

        console.log('Production model:', productionModel);
        console.log('Current process:', currentProcess);

        // 상태 업데이트
        setMachineDetails({
          productionModel,
          currentProcess,
          loading: false,
          error: null
        });

        // 성공 메시지
        if (productionModel && currentProcess) {
          message.success(`설비 정보를 성공적으로 로드했습니다`);
        } else {
          message.warning('일부 설비 정보가 설정되어 있지 않습니다');
        }

      } catch (error: any) {
        console.error('Error loading machine details:', error);
        setMachineDetails(prev => ({
          ...prev,
          loading: false,
          error: error.message || '설비 정보 로드에 실패했습니다'
        }));
        
        message.error(`설비 정보 로드 실패: ${error.message}`);
      }
    }
  };

  // 생산량 변경 핸들러
  const handleProductionChange = (field: 'actual_production' | 'defect_quantity', value: number) => {
    const currentData = getCurrentShiftData();
    const updates: Partial<ShiftProductionData> = { [field]: value };
    
    if (field === 'actual_production' || field === 'defect_quantity') {
      const actualProduction = field === 'actual_production' ? value : currentData.actual_production;
      const defectQuantity = field === 'defect_quantity' ? value : currentData.defect_quantity;
      updates.good_quantity = Math.max(0, actualProduction - defectQuantity);
    }
    
    updateCurrentShiftData(updates);
  };

  // 비가동 시간 추가
  const addDowntimeEntry = (values: { start_time: string; end_time?: string; reason: string; description?: string }) => {
    if (!selectedMachineId) {
      message.error('먼저 설비를 선택하세요');
      return;
    }

    const startTime = dayjs(values.start_time);
    const endTime = values.end_time ? dayjs(values.end_time) : dayjs();
    const duration = endTime.diff(startTime, 'minute');

    const newEntry: DowntimeEntry = {
      id: Date.now().toString(),
      machine_id: selectedMachineId,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      duration_minutes: duration,
      reason: values.reason,
      description: values.description || ''
    };

    const currentData = getCurrentShiftData();
    const updatedEntries = [...currentData.downtime_entries, newEntry];
    const totalDowntime = updatedEntries.reduce((sum, entry) => sum + (entry.duration_minutes || 0), 0);

    updateCurrentShiftData({
      downtime_entries: updatedEntries,
      total_downtime_minutes: totalDowntime
    });

    setDowntimeModalVisible(false);
    downtimeForm.resetFields();
    message.success('비가동 시간이 추가되었습니다');
  };

  // 비가동 시간 삭제
  const removeDowntimeEntry = (entryId: string) => {
    const currentData = getCurrentShiftData();
    const updatedEntries = currentData.downtime_entries.filter(entry => entry.id !== entryId);
    const totalDowntime = updatedEntries.reduce((sum, entry) => sum + (entry.duration_minutes || 0), 0);

    updateCurrentShiftData({
      downtime_entries: updatedEntries,
      total_downtime_minutes: totalDowntime
    });

    message.success('비가동 시간이 삭제되었습니다');
  };

  // 일일 데이터 계산
  const calculateDailyData = (): DailyProductionData => {
    // 휴무가 아닌 교대조의 데이터만 합산
    const totalProduction = 
      (!dayShiftOff ? dayShiftData.actual_production : 0) + 
      (!nightShiftOff ? nightShiftData.actual_production : 0);
    const totalDefects = 
      (!dayShiftOff ? dayShiftData.defect_quantity : 0) + 
      (!nightShiftOff ? nightShiftData.defect_quantity : 0);
    const totalGoodQuantity = 
      (!dayShiftOff ? dayShiftData.good_quantity : 0) + 
      (!nightShiftOff ? nightShiftData.good_quantity : 0);
    const totalDowntime = 
      (!dayShiftOff ? dayShiftData.total_downtime_minutes : 0) + 
      (!nightShiftOff ? nightShiftData.total_downtime_minutes : 0);

    // 기준 생산량(CAPA) = Tact Time * 교대조별 가동시간 합계
    const tactTime = machineDetails.currentProcess?.tact_time_seconds || 120;
    const totalOperatingMinutes = 
      (!dayShiftOff ? dayShiftOperatingMinutes : 0) + 
      (!nightShiftOff ? nightShiftOperatingMinutes : 0);
    const plannedCapacity = calculateCapacity(tactTime, totalOperatingMinutes);

    // OEE 계산 (휴무 교대조 제외)
    const plannedOperatingTime = totalOperatingMinutes; // 분 단위
    const actualOperatingTime = Math.max(0, plannedOperatingTime - totalDowntime);
    const availability = plannedOperatingTime > 0 ? actualOperatingTime / plannedOperatingTime : 0;
    const performance = plannedCapacity > 0 ? Math.min(1, totalProduction / plannedCapacity) : 0;
    const quality = totalProduction > 0 ? totalGoodQuantity / totalProduction : 1;
    const oee = availability * performance * quality;

    return {
      machine_id: selectedMachineId || '',
      date: selectedDate,
      day_shift: dayShiftData,
      night_shift: nightShiftData,
      total_production: totalProduction,
      total_defects: totalDefects,
      total_good_quantity: totalGoodQuantity,
      total_downtime_minutes: totalDowntime,
      planned_capacity: plannedCapacity,
      availability: Math.max(0, Math.min(1, availability)),
      performance: Math.max(0, Math.min(1, performance)),
      quality: Math.max(0, Math.min(1, quality)),
      oee: Math.max(0, Math.min(1, oee))
    };
  };

  // 데이터 저장
  const handleSave = async () => {
    if (!selectedMachineId) {
      message.error('설비를 선택하세요');
      return;
    }

    try {
      setLoading(true);
      const dailyData = calculateDailyData();

      console.log('Saving daily production data:', dailyData);

      const response = await fetch('/api/production-records/daily', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dailyData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      message.success(result.message || '생산 데이터가 저장되었습니다');
      
      // 폼 초기화
      setSelectedMachineId(null);
      setDayShiftData({
        shift: 'DAY',
        shift_name: '주간조',
        start_time: '08:00',
        end_time: '20:00',
        operator_name: '',
        actual_production: 0,
        defect_quantity: 0,
        good_quantity: 0,
        downtime_entries: [],
        total_downtime_minutes: 0
      });
      setNightShiftData({
        shift: 'NIGHT',
        shift_name: '야간조',
        start_time: '20:00',
        end_time: '08:00',
        operator_name: '',
        actual_production: 0,
        defect_quantity: 0,
        good_quantity: 0,
        downtime_entries: [],
        total_downtime_minutes: 0
      });

    } catch (error: any) {
      console.error('Error saving data:', error);
      message.error(`저장 실패: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 비가동 시간 테이블 컬럼
  const downtimeColumns = [
    {
      title: '시작 시간',
      dataIndex: 'start_time',
      key: 'start_time',
      render: (time: string) => dayjs(time).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '종료 시간',
      dataIndex: 'end_time',
      key: 'end_time',
      render: (time: string) => time ? dayjs(time).format('YYYY-MM-DD HH:mm') : '진행중'
    },
    {
      title: '지속 시간',
      dataIndex: 'duration_minutes',
      key: 'duration_minutes',
      render: (minutes: number) => `${minutes}분`
    },
    {
      title: '사유',
      dataIndex: 'reason',
      key: 'reason'
    },
    {
      title: '작업',
      key: 'actions',
      render: (_: any, record: DowntimeEntry) => (
        <Popconfirm
          title="이 비가동 시간을 삭제하시겠습니까?"
          onConfirm={() => removeDowntimeEntry(record.id!)}
          okText="삭제"
          cancelText="취소"
        >
          <Button type="link" danger icon={<DeleteOutlined />} size="small">
            삭제
          </Button>
        </Popconfirm>
      )
    }
  ];

  const currentShiftData = getCurrentShiftData();
  const dailyData = calculateDailyData();
  const selectedMachine = getSelectedMachine();

  return (
    <div>
      {/* 설비 선택 및 날짜 */}
      <Card title={t('dataInputForm.machineSelection')} size="small" style={{ marginBottom: '16px' }}>
        <Row gutter={[16, 0]} align="middle">
          <Col xs={24} sm={12}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text strong>{t('dataInputForm.machine')}</Text>
              <Select
                placeholder={t('dataInputForm.machineSelectPlaceholder')}
                loading={machinesLoading}
                onChange={handleMachineSelect}
                value={selectedMachineId}
                style={{ width: '100%' }}
                showSearch
                optionFilterProp="children"
                size="large"
              >
                {machines.map((machine) => (
                  <Option key={machine.id} value={machine.id}>
                    {machine.name}
                    <span style={{ color: '#8c8c8c', fontSize: '12px', marginLeft: '8px' }}>
                      - {machine.location}
                    </span>
                  </Option>
                ))}
              </Select>
              {machinesError && (
                <Alert message="설비 로딩 오류" type="error" showIcon />
              )}
            </Space>
          </Col>
          <Col xs={24} sm={12}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text strong>{t('dataInputForm.selectedDate')}</Text>
              <DatePicker
                value={dayjs(selectedDate)}
                onChange={(date) => setSelectedDate(date?.format('YYYY-MM-DD') || dayjs().format('YYYY-MM-DD'))}
                style={{ width: '100%' }}
                size="large"
                format="YYYY-MM-DD"
              />
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 설비 정보 표시 */}
      {selectedMachine && (
        <Card 
          title={t('dataInputForm.machineInfo')} 
          size="small" 
          style={{ marginBottom: '16px' }}
        >
          {machineDetails.error && (
            <Alert
              message="설비 정보 로드 오류"
              description={machineDetails.error}
              type="error"
              showIcon
              style={{ marginBottom: '16px' }}
            />
          )}
          <Descriptions column={2} size="small">
            {/* 왼쪽 컬럼 */}
            <Descriptions.Item label="생산 모델" span={1}>
              {machineDetails.loading ? (
                <Text type="secondary">로딩 중...</Text>
              ) : machineDetails.productionModel ? (
                <Text code>{machineDetails.productionModel.model_name}</Text>
              ) : (
                <Text type="secondary">설정 없음</Text>
              )}
            </Descriptions.Item>
            
            {/* 오른쪽 컬럼 */}
            <Descriptions.Item label="주간조 기본 가동 시간" span={1}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Space>
                  <InputNumber
                    value={dayShiftOperatingMinutes}
                    onChange={(value) => setDayShiftOperatingMinutes(value || 720)}
                    min={0}
                    max={720}
                    addonAfter="분"
                    style={{ width: 120 }}
                    disabled={dayShiftOff}
                  />
                  <Checkbox 
                    checked={dayShiftOff} 
                    onChange={(e) => setDayShiftOff(e.target.checked)}
                  >
                    휴무
                  </Checkbox>
                </Space>
                {!dayShiftOff && (
                  <div>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      ({Math.floor(dayShiftOperatingMinutes / 60)}시간 {dayShiftOperatingMinutes % 60}분)
                    </Text>
                    <Text strong style={{ color: '#1890ff', marginLeft: 8 }}>
                      CAPA: {machineDetails.currentProcess?.tact_time_seconds 
                        ? calculateCapacity(machineDetails.currentProcess.tact_time_seconds, dayShiftOperatingMinutes)
                        : 0
                      }개
                    </Text>
                  </div>
                )}
                {dayShiftOff && <Text type="secondary"> (휴무)</Text>}
              </Space>
            </Descriptions.Item>

            <Descriptions.Item label="가공 공정" span={1}>
              {machineDetails.loading ? (
                <Text type="secondary">로딩 중...</Text>
              ) : machineDetails.currentProcess ? (
                <Text code>{machineDetails.currentProcess.process_name}</Text>
              ) : (
                <Text type="secondary">설정 없음</Text>
              )}
            </Descriptions.Item>

            <Descriptions.Item label="야간조 기본 가동 시간" span={1}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Space>
                  <InputNumber
                    value={nightShiftOperatingMinutes}
                    onChange={(value) => setNightShiftOperatingMinutes(value || 720)}
                    min={0}
                    max={720}
                    addonAfter="분"
                    style={{ width: 120 }}
                    disabled={nightShiftOff}
                  />
                  <Checkbox 
                    checked={nightShiftOff} 
                    onChange={(e) => setNightShiftOff(e.target.checked)}
                  >
                    휴무
                  </Checkbox>
                </Space>
                {!nightShiftOff && (
                  <div>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      ({Math.floor(nightShiftOperatingMinutes / 60)}시간 {nightShiftOperatingMinutes % 60}분)
                    </Text>
                    <Text strong style={{ color: '#1890ff', marginLeft: 8 }}>
                      CAPA: {machineDetails.currentProcess?.tact_time_seconds 
                        ? calculateCapacity(machineDetails.currentProcess.tact_time_seconds, nightShiftOperatingMinutes)
                        : 0
                      }개
                    </Text>
                  </div>
                )}
                {nightShiftOff && <Text type="secondary"> (휴무)</Text>}
              </Space>
            </Descriptions.Item>

            <Descriptions.Item label="Tact Time" span={1}>
              {machineDetails.loading ? (
                <Text type="secondary">로딩 중...</Text>
              ) : machineDetails.currentProcess?.tact_time_seconds ? (
                <Text code>{machineDetails.currentProcess.tact_time_seconds}초</Text>
              ) : (
                <Text type="secondary">설정 없음</Text>
              )}
            </Descriptions.Item>

            <Descriptions.Item label="일일 총 CAPA" span={1}>
              <Text strong style={{ color: '#52c41a', fontSize: '16px' }}>
                {machineDetails.currentProcess?.tact_time_seconds 
                  ? (
                      (!dayShiftOff ? calculateCapacity(machineDetails.currentProcess.tact_time_seconds, dayShiftOperatingMinutes) : 0) +
                      (!nightShiftOff ? calculateCapacity(machineDetails.currentProcess.tact_time_seconds, nightShiftOperatingMinutes) : 0)
                    )
                  : 0
                }개
              </Text>
            </Descriptions.Item>

            <Descriptions.Item label="설비 상태" span={2}>
              <Badge 
                status={selectedMachine.current_state === 'NORMAL_OPERATION' ? 'processing' : 'error'} 
                text={selectedMachine.current_state === 'NORMAL_OPERATION' ? '정상 가동' : '비정상'}
              />
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {/* 교대별 데이터 입력 */}
      {selectedMachineId && (
        <Card 
          title="교대별 생산 데이터 입력" 
          size="small" 
          style={{ marginBottom: '16px' }}
        >
          <Tabs 
            activeKey={activeShift} 
            onChange={(key) => setActiveShift(key as 'DAY' | 'NIGHT')}
            items={[
              {
                key: 'DAY',
                label: (
                  <span>
                    <SunOutlined />
                    주간조 (08:00-20:00)
                    {dayShiftOff && (
                      <Badge status="default" text="휴무" style={{ marginLeft: 8 }} />
                    )}
                    {!dayShiftOff && dayShiftData.actual_production > 0 && (
                      <Badge count={dayShiftData.actual_production} style={{ marginLeft: 8 }} />
                    )}
                  </span>
                ),
                children: (
                  <div style={{ opacity: dayShiftOff ? 0.5 : 1 }}>
                    {dayShiftOff && (
                      <Alert
                        message="주간조 휴무"
                        description="주간조가 휴무로 설정되어 있습니다. 설비 정보에서 휴무를 해제하면 데이터를 입력할 수 있습니다."
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                      />
                    )}
                    <Row gutter={[16, 16]}>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>입력자</Text>
                          <Select
                            placeholder="입력자를 선택하세요"
                            value={dayShiftData.operator_name || undefined}
                            onChange={(value) => updateCurrentShiftData({ operator_name: value })}
                            disabled={dayShiftOff}
                            loading={profilesLoading}
                            style={{ width: '100%' }}
                            showSearch
                            optionFilterProp="children"
                          >
                            {profiles.map((profile) => (
                              <Option key={profile.user_id} value={profile.name}>
                                {profile.name}
                                {profile.role && (
                                  <span style={{ color: '#8c8c8c', fontSize: '12px', marginLeft: '8px' }}>
                                    - {profile.role === 'admin' ? '관리자' : profile.role === 'engineer' ? '엔지니어' : '운영자'}
                                  </span>
                                )}
                              </Option>
                            ))}
                          </Select>
                        </Space>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>실제 생산량</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="480"
                            value={dayShiftData.actual_production}
                            onChange={(value) => handleProductionChange('actual_production', value || 0)}
                            addonAfter="개"
                            disabled={dayShiftOff}
                          />
                        </Space>
                      </Col>
                    </Row>
                    
                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>불량 수량</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="5"
                            value={dayShiftData.defect_quantity}
                            onChange={(value) => handleProductionChange('defect_quantity', value || 0)}
                            addonAfter="개"
                            disabled={dayShiftOff}
                          />
                        </Space>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>양품 수량</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            value={dayShiftData.good_quantity}
                            addonAfter="개"
                            readOnly
                            disabled={dayShiftOff}
                          />
                        </Space>
                      </Col>
                    </Row>
                  </div>
                )
              },
              {
                key: 'NIGHT',
                label: (
                  <span>
                    <MoonOutlined />
                    야간조 (20:00-08:00)
                    {nightShiftOff && (
                      <Badge status="default" text="휴무" style={{ marginLeft: 8 }} />
                    )}
                    {!nightShiftOff && nightShiftData.actual_production > 0 && (
                      <Badge count={nightShiftData.actual_production} style={{ marginLeft: 8 }} />
                    )}
                  </span>
                ),
                children: (
                  <div style={{ opacity: nightShiftOff ? 0.5 : 1 }}>
                    {nightShiftOff && (
                      <Alert
                        message="야간조 휴무"
                        description="야간조가 휴무로 설정되어 있습니다. 설비 정보에서 휴무를 해제하면 데이터를 입력할 수 있습니다."
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                      />
                    )}
                    <Row gutter={[16, 16]}>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>입력자</Text>
                          <Select
                            placeholder="입력자를 선택하세요"
                            value={nightShiftData.operator_name || undefined}
                            onChange={(value) => updateCurrentShiftData({ operator_name: value })}
                            disabled={nightShiftOff}
                            loading={profilesLoading}
                            style={{ width: '100%' }}
                            showSearch
                            optionFilterProp="children"
                          >
                            {profiles.map((profile) => (
                              <Option key={profile.user_id} value={profile.name}>
                                {profile.name}
                                {profile.role && (
                                  <span style={{ color: '#8c8c8c', fontSize: '12px', marginLeft: '8px' }}>
                                    - {profile.role === 'admin' ? '관리자' : profile.role === 'engineer' ? '엔지니어' : '운영자'}
                                  </span>
                                )}
                              </Option>
                            ))}
                          </Select>
                        </Space>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>실제 생산량</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="480"
                            value={nightShiftData.actual_production}
                            onChange={(value) => handleProductionChange('actual_production', value || 0)}
                            addonAfter="개"
                            disabled={nightShiftOff}
                          />
                        </Space>
                      </Col>
                    </Row>
                    
                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>불량 수량</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="5"
                            value={nightShiftData.defect_quantity}
                            onChange={(value) => handleProductionChange('defect_quantity', value || 0)}
                            addonAfter="개"
                            disabled={nightShiftOff}
                          />
                        </Space>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>양품 수량</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            value={nightShiftData.good_quantity}
                            addonAfter="개"
                            readOnly
                            disabled={nightShiftOff}
                          />
                        </Space>
                      </Col>
                    </Row>
                  </div>
                )
              }
            ]}
          />
        </Card>
      )}

      {/* 비가동 시간 */}
      {selectedMachineId && (
        <Card 
          title={`비가동 시간 - ${activeShift === 'DAY' ? '주간조' : '야간조'}`}
          size="small" 
          style={{ marginBottom: '16px' }}
          extra={
            <Button 
              type="primary" 
              icon={<ClockCircleOutlined />} 
              size="small"
              onClick={() => setDowntimeModalVisible(true)}
              disabled={(activeShift === 'DAY' && dayShiftOff) || (activeShift === 'NIGHT' && nightShiftOff)}
            >
              비가동 시간 추가
            </Button>
          }
        >
          <Table
            dataSource={currentShiftData.downtime_entries}
            columns={downtimeColumns}
            rowKey="id"
            size="small"
            pagination={false}
            locale={{ emptyText: '등록된 비가동 시간이 없습니다' }}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <Text strong>총 비가동 시간</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2}>
                  <Text strong>{currentShiftData.total_downtime_minutes}분</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} colSpan={2} />
              </Table.Summary.Row>
            )}
          />
        </Card>
      )}

      {/* 일일 요약 */}
      {selectedMachineId && (dayShiftData.actual_production > 0 || nightShiftData.actual_production > 0) && (
        <Card title="일일 생산 요약" size="small" style={{ marginBottom: '24px' }}>
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={6}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">총 생산량</Text>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#1890ff' }}>
                  {dailyData.total_production}개
                </div>
              </div>
            </Col>
            <Col xs={12} sm={6}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">총 불량</Text>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#ff4d4f' }}>
                  {dailyData.total_defects}개
                </div>
              </div>
            </Col>
            <Col xs={12} sm={6}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">총 비가동</Text>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#faad14' }}>
                  {dailyData.total_downtime_minutes}분
                </div>
              </div>
            </Col>
            <Col xs={12} sm={6}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">OEE</Text>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#52c41a' }}>
                  {(dailyData.oee * 100).toFixed(1)}%
                </div>
              </div>
            </Col>
          </Row>
        </Card>
      )}

      {/* 저장 버튼 */}
      {selectedMachineId && (
        <div style={{ textAlign: 'center' }}>
          <Button 
            type="primary" 
            htmlType="submit" 
            loading={loading}
            icon={<SaveOutlined />}
            size="large"
            onClick={handleSave}
            disabled={
              (dayShiftOff && nightShiftOff) || 
              (!dayShiftOff && !dayShiftData.actual_production && !nightShiftOff && !nightShiftData.actual_production)
            }
          >
            생산 데이터 저장
          </Button>
        </div>
      )}

      {/* 비가동 시간 추가 모달 */}
      <Modal
        title={`비가동 시간 추가 - ${activeShift === 'DAY' ? '주간조' : '야간조'}`}
        open={downtimeModalVisible}
        onCancel={() => setDowntimeModalVisible(false)}
        footer={null}
      >
        <Form
          form={downtimeForm}
          layout="vertical"
          onFinish={addDowntimeEntry}
        >
          <Form.Item
            name="start_time"
            label="시작 시간"
            rules={[{ required: true, message: '시작 시간을 선택하세요' }]}
          >
            <Input 
              type="datetime-local" 
              style={{ width: '100%' }}
              defaultValue={`${selectedDate}T${activeShift === 'DAY' ? '10:00' : '22:00'}`}
            />
          </Form.Item>
          
          <Form.Item
            name="end_time"
            label="종료 시간"
          >
            <Input 
              type="datetime-local" 
              style={{ width: '100%' }}
              placeholder="현재 시간이 기본값입니다"
            />
          </Form.Item>

          <Form.Item
            name="reason"
            label="비가동 사유"
            rules={[{ required: true, message: '비가동 사유를 선택하세요' }]}
          >
            <Select placeholder="사유를 선택하세요">
              {downtimeReasons.map((reason: string) => (
                <Option key={reason} value={reason}>
                  {reason}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="description"
            label="상세 설명"
          >
            <TextArea
              rows={3}
              placeholder="비가동 상세 내용을 입력하세요"
            />
          </Form.Item>

          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setDowntimeModalVisible(false)}>
                취소
              </Button>
              <Button type="primary" htmlType="submit">
                추가
              </Button>
            </Space>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default ShiftDataInputForm;