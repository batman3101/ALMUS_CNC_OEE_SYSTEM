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
import { useDataInputTranslation } from '@/hooks/useTranslation';
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
  const { t } = useDataInputTranslation();
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
    shift_name: t('shift.dayShift'),
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
    shift_name: t('shift.nightShift'),
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
    t('downtime.reasons.equipmentFailure'),
    t('downtime.reasons.moldChange'), 
    t('downtime.reasons.materialShortage'),
    t('downtime.reasons.qualityDefect'),
    t('downtime.reasons.plannedStop'),
    t('downtime.reasons.cleaning'),
    t('downtime.reasons.other')
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
      throw new Error(t('messages.noProductionModel'));
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
      throw new Error(t('messages.noProcess'));
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
          message.success(t('messages.machineInfoLoadSuccess'));
        } else {
          message.warning(t('messages.machineInfoPartialWarning'));
        }

      } catch (error: any) {
        console.error('Error loading machine details:', error);
        setMachineDetails(prev => ({
          ...prev,
          loading: false,
          error: error.message || t('messages.machineInfoLoadFailed')
        }));
        
        message.error(`${t('messages.machineInfoLoadFailed')}: ${error.message}`);
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
      message.error(t('messages.selectMachineFirst'));
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
    message.success(t('messages.downtimeAdded'));
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

    message.success(t('messages.downtimeDeleted'));
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
      message.error(t('messages.selectMachine'));
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
      message.success(result.message || t('messages.productionDataSaved'));
      
      // 폼 초기화
      setSelectedMachineId(null);
      setDayShiftData({
        shift: 'DAY',
        shift_name: t('shift.dayShift'),
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
        shift_name: t('shift.nightShift'),
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
      message.error(`${t('messages.saveFailed')}: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 비가동 시간 테이블 컬럼
  const downtimeColumns = [
    {
      title: t('dataEntry.startTime'),
      dataIndex: 'start_time',
      key: 'start_time',
      render: (time: string) => dayjs(time).format('YYYY-MM-DD HH:mm')
    },
    {
      title: t('dataEntry.endTime'),
      dataIndex: 'end_time',
      key: 'end_time',
      render: (time: string) => time ? dayjs(time).format('YYYY-MM-DD HH:mm') : t('dataEntry.ongoing')
    },
    {
      title: t('dataEntry.downtime'),
      dataIndex: 'duration_minutes',
      key: 'duration_minutes',
      render: (minutes: number) => `${minutes}${t('schedule.minutes')}`
    },
    {
      title: t('dataEntry.reason'),
      dataIndex: 'reason',
      key: 'reason'
    },
    {
      title: t('dataEntry.work'),
      key: 'actions',
      render: (_: any, record: DowntimeEntry) => (
        <Popconfirm
          title={t('downtime.deleteConfirm')}
          onConfirm={() => removeDowntimeEntry(record.id!)}
          okText={t('downtime.delete')}
          cancelText={t('downtime.cancel')}
        >
          <Button type="link" danger icon={<DeleteOutlined />} size="small">
            {t('downtime.delete')}
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
                <Alert message={t('messages.machineLoadingError')} type="error" showIcon />
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
              message={t('messages.machineInfoLoadFailed')}
              description={machineDetails.error}
              type="error"
              showIcon
              style={{ marginBottom: '16px' }}
            />
          )}
          <Descriptions column={2} size="small">
            {/* 왼쪽 컬럼 */}
            <Descriptions.Item label={t('machineInfo.productionModel')} span={1}>
              {machineDetails.loading ? (
                <Text type="secondary">{t('machineInfo.loadingText')}</Text>
              ) : machineDetails.productionModel ? (
                <Text code>{machineDetails.productionModel.model_name}</Text>
              ) : (
                <Text type="secondary">{t('machineInfo.noSetting')}</Text>
              )}
            </Descriptions.Item>
            
            {/* 오른쪽 컬럼 */}
            <Descriptions.Item label={t('shift.dayShiftBaseOperatingTime')} span={1}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Space>
                  <InputNumber
                    value={dayShiftOperatingMinutes}
                    onChange={(value) => setDayShiftOperatingMinutes(value || 720)}
                    min={0}
                    max={720}
                    addonAfter={t('common.minutes')}
                    style={{ width: 120 }}
                    disabled={dayShiftOff}
                  />
                  <Checkbox 
                    checked={dayShiftOff} 
                    onChange={(e) => setDayShiftOff(e.target.checked)}
                  >
                    {t('common.off')}
                  </Checkbox>
                </Space>
                {!dayShiftOff && (
                  <div>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      ({Math.floor(dayShiftOperatingMinutes / 60)}{t('common.hours')} {dayShiftOperatingMinutes % 60}{t('common.minutes')})
                    </Text>
                    <Text strong style={{ color: '#1890ff', marginLeft: 8 }}>
                      CAPA: {machineDetails.currentProcess?.tact_time_seconds 
                        ? calculateCapacity(machineDetails.currentProcess.tact_time_seconds, dayShiftOperatingMinutes)
                        : 0
                      }{t('common.pieces')}
                    </Text>
                  </div>
                )}
                {dayShiftOff && <Text type="secondary"> ({t('common.off')})</Text>}
              </Space>
            </Descriptions.Item>

            <Descriptions.Item label={t('machineInfo.process')} span={1}>
              {machineDetails.loading ? (
                <Text type="secondary">{t('machineInfo.loadingText')}</Text>
              ) : machineDetails.currentProcess ? (
                <Text code>{machineDetails.currentProcess.process_name}</Text>
              ) : (
                <Text type="secondary">{t('machineInfo.noSetting')}</Text>
              )}
            </Descriptions.Item>

            <Descriptions.Item label={t('shift.nightShiftBaseOperatingTime')} span={1}>
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Space>
                  <InputNumber
                    value={nightShiftOperatingMinutes}
                    onChange={(value) => setNightShiftOperatingMinutes(value || 720)}
                    min={0}
                    max={720}
                    addonAfter={t('common.minutes')}
                    style={{ width: 120 }}
                    disabled={nightShiftOff}
                  />
                  <Checkbox 
                    checked={nightShiftOff} 
                    onChange={(e) => setNightShiftOff(e.target.checked)}
                  >
                    {t('common.off')}
                  </Checkbox>
                </Space>
                {!nightShiftOff && (
                  <div>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      ({Math.floor(nightShiftOperatingMinutes / 60)}{t('common.hours')} {nightShiftOperatingMinutes % 60}{t('common.minutes')})
                    </Text>
                    <Text strong style={{ color: '#1890ff', marginLeft: 8 }}>
                      CAPA: {machineDetails.currentProcess?.tact_time_seconds 
                        ? calculateCapacity(machineDetails.currentProcess.tact_time_seconds, nightShiftOperatingMinutes)
                        : 0
                      }{t('common.pieces')}
                    </Text>
                  </div>
                )}
                {nightShiftOff && <Text type="secondary"> ({t('common.off')})</Text>}
              </Space>
            </Descriptions.Item>

            <Descriptions.Item label="Tact Time" span={1}>
              {machineDetails.loading ? (
                <Text type="secondary">{t('machineInfo.loadingText')}</Text>
              ) : machineDetails.currentProcess?.tact_time_seconds ? (
                <Text code>{machineDetails.currentProcess.tact_time_seconds}{t('common.seconds')}</Text>
              ) : (
                <Text type="secondary">{t('machineInfo.noSetting')}</Text>
              )}
            </Descriptions.Item>

            <Descriptions.Item label={t('schedule.dailyTotalCapa')} span={1}>
              <Text strong style={{ color: '#52c41a', fontSize: '16px' }}>
                {machineDetails.currentProcess?.tact_time_seconds 
                  ? (
                      (!dayShiftOff ? calculateCapacity(machineDetails.currentProcess.tact_time_seconds, dayShiftOperatingMinutes) : 0) +
                      (!nightShiftOff ? calculateCapacity(machineDetails.currentProcess.tact_time_seconds, nightShiftOperatingMinutes) : 0)
                    )
                  : 0
                }{t('common.pieces')}
              </Text>
            </Descriptions.Item>

            <Descriptions.Item label={t('machineInfo.machineStatus')} span={2}>
              <Badge 
                status={selectedMachine.current_state === 'NORMAL_OPERATION' ? 'processing' : 'error'} 
                text={selectedMachine.current_state === 'NORMAL_OPERATION' ? t('machineInfo.normalOperation') : t('machineInfo.abnormal')}
              />
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {/* 교대별 데이터 입력 */}
      {selectedMachineId && (
        <Card 
          title={t('dataEntry.shiftDataInput')} 
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
                    {t('shift.dayShiftTime')}
                    {dayShiftOff && (
                      <Badge status="default" text={t('common.off')} style={{ marginLeft: 8 }} />
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
                        message={t('shift.dayShiftOff')}
                        description={t('shift.dayShiftOffDescription')}
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                      />
                    )}
                    <Row gutter={[16, 16]}>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.operator')}</Text>
                          <Select
                            placeholder={t('dataEntry.selectOperator')}
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
                                    - {profile.role === 'admin' ? t('dataEntry.admin') : profile.role === 'engineer' ? t('dataEntry.engineer') : t('dataEntry.operator_role')}
                                  </span>
                                )}
                              </Option>
                            ))}
                          </Select>
                        </Space>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.actualProduction')}</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="480"
                            value={dayShiftData.actual_production}
                            onChange={(value) => handleProductionChange('actual_production', value || 0)}
                            addonAfter={t('common.pieces')}
                            disabled={dayShiftOff}
                          />
                        </Space>
                      </Col>
                    </Row>
                    
                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.defects')}</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="5"
                            value={dayShiftData.defect_quantity}
                            onChange={(value) => handleProductionChange('defect_quantity', value || 0)}
                            addonAfter={t('common.pieces')}
                            disabled={dayShiftOff}
                          />
                        </Space>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.goodQuantity')}</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            value={dayShiftData.good_quantity}
                            addonAfter={t('common.pieces')}
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
                    {t('shift.nightShiftTime')}
                    {nightShiftOff && (
                      <Badge status="default" text={t('common.off')} style={{ marginLeft: 8 }} />
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
                        message={t('shift.nightShiftOff')}
                        description={t('shift.nightShiftOffDescription')}
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                      />
                    )}
                    <Row gutter={[16, 16]}>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.operator')}</Text>
                          <Select
                            placeholder={t('dataEntry.selectOperator')}
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
                                    - {profile.role === 'admin' ? t('dataEntry.admin') : profile.role === 'engineer' ? t('dataEntry.engineer') : t('dataEntry.operator_role')}
                                  </span>
                                )}
                              </Option>
                            ))}
                          </Select>
                        </Space>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.actualProduction')}</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="480"
                            value={nightShiftData.actual_production}
                            onChange={(value) => handleProductionChange('actual_production', value || 0)}
                            addonAfter={t('common.pieces')}
                            disabled={nightShiftOff}
                          />
                        </Space>
                      </Col>
                    </Row>
                    
                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.defects')}</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            placeholder="5"
                            value={nightShiftData.defect_quantity}
                            onChange={(value) => handleProductionChange('defect_quantity', value || 0)}
                            addonAfter={t('common.pieces')}
                            disabled={nightShiftOff}
                          />
                        </Space>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <Text strong>{t('dataEntry.goodQuantity')}</Text>
                          <InputNumber
                            style={{ width: '100%' }}
                            value={nightShiftData.good_quantity}
                            addonAfter={t('common.pieces')}
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
          title={`${t('downtime.downtimeTitle')} - ${activeShift === 'DAY' ? t('shift.dayShift') : t('shift.nightShift')}`}
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
              {t('downtime.addDowntime')}
            </Button>
          }
        >
          <Table
            dataSource={currentShiftData.downtime_entries}
            columns={downtimeColumns}
            rowKey="id"
            size="small"
            pagination={false}
            locale={{ emptyText: t('downtime.noDowntimeRecords') }}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <Text strong>{t('dataEntry.totalDowntime')}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2}>
                  <Text strong>{currentShiftData.total_downtime_minutes}{t('common.minutes')}</Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} colSpan={2} />
              </Table.Summary.Row>
            )}
          />
        </Card>
      )}

      {/* 일일 요약 */}
      {selectedMachineId && (dayShiftData.actual_production > 0 || nightShiftData.actual_production > 0) && (
        <Card title={t('common.dailySummary')} size="small" style={{ marginBottom: '24px' }}>
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={6}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">{t('dataEntry.production')}</Text>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#1890ff' }}>
                  {dailyData.total_production}{t('common.pieces')}
                </div>
              </div>
            </Col>
            <Col xs={12} sm={6}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">{t('dataEntry.defects')}</Text>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#ff4d4f' }}>
                  {dailyData.total_defects}{t('common.pieces')}
                </div>
              </div>
            </Col>
            <Col xs={12} sm={6}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">{t('dataEntry.totalDowntime')}</Text>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#faad14' }}>
                  {dailyData.total_downtime_minutes}{t('common.minutes')}
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
            {t('dataEntry.saveProductionData')}
          </Button>
        </div>
      )}

      {/* 비가동 시간 추가 모달 */}
      <Modal
        title={`${t('downtime.modalTitle')} - ${activeShift === 'DAY' ? t('shift.dayShift') : t('shift.nightShift')}`}
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
            label={t('downtime.startTimeLabel')}
            rules={[{ required: true, message: t('downtime.selectStartTime') }]}
          >
            <Input 
              type="datetime-local" 
              style={{ width: '100%' }}
              defaultValue={`${selectedDate}T${activeShift === 'DAY' ? '10:00' : '22:00'}`}
            />
          </Form.Item>
          
          <Form.Item
            name="end_time"
            label={t('downtime.endTimeLabel')}
          >
            <Input 
              type="datetime-local" 
              style={{ width: '100%' }}
              placeholder={t('common.defaultTimeNote')}
            />
          </Form.Item>

          <Form.Item
            name="reason"
            label={t('downtime.selectReason')}
            rules={[{ required: true, message: t('downtime.selectReason') }]}
          >
            <Select placeholder={t('downtime.selectReason')}>
              {downtimeReasons.map((reason: string) => (
                <Option key={reason} value={reason}>
                  {reason}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="description"
            label={t('downtime.detailDescription')}
          >
            <TextArea
              rows={3}
              placeholder={t('downtime.detailPlaceholder')}
            />
          </Form.Item>

          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setDowntimeModalVisible(false)}>
                {t('downtime.cancel')}
              </Button>
              <Button type="primary" htmlType="submit">
                {t('downtime.add')}
              </Button>
            </Space>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default ShiftDataInputForm;