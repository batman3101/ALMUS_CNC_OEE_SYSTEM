'use client';

import React, { useState, useEffect } from 'react';
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
  Divider,
  Typography,
  message,
  DatePicker,
  TimePicker,
  Table,
  Modal,
  Popconfirm,
  Spin,
  Alert
} from 'antd';
import {
  SaveOutlined,
  PlusOutlined,
  DeleteOutlined,
  CalculatorOutlined,
  ClockCircleOutlined,
  LoadingOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useProductModels } from '@/hooks/useProductModels';
import { useModelProcesses } from '@/hooks/useModelProcesses';
import type { MachineDataInput, DowntimeEntry, MachineProcess } from '@/types/dataInput';
import type { Database } from '@/types/database';

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

type ProductModel = Database['public']['Tables']['product_models']['Row'];
type ModelProcess = Database['public']['Tables']['model_processes']['Row'];

const DataInputForm: React.FC = () => {
  const { t } = useLanguage();
  const { getSetting } = useSystemSettings();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [downtimeEntries, setDowntimeEntries] = useState<DowntimeEntry[]>([]);
  const [downtimeModalVisible, setDowntimeModalVisible] = useState(false);
  const [downtimeForm] = Form.useForm();

  // Product models and processes state
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  
  // Hooks for fetching data
  const { models, loading: modelsLoading, error: modelsError } = useProductModels();
  const { 
    processes: modelProcesses, 
    loading: processesLoading, 
    error: processesError, 
    fetchProcesses,
    clearProcesses
  } = useModelProcesses();

  // 비가동 사유 목록 가져오기
  const downtimeReasons = getSetting('general', 'downtime_reasons') || [
    '설비 고장', '금형 교체', '자재 부족', '품질 불량', '계획 정지', '청소/정리', '기타'
  ];

  // 일일 생산량(CAPA) 자동 계산
  const calculateDailyCapacity = (operatingHours: number, tactTime: number) => {
    if (!operatingHours || !tactTime) return 0;
    return Math.floor((operatingHours * 3600) / tactTime); // 시간을 초로 변환 후 계산
  };

  // 모델 선택 핸들러
  const handleModelSelect = async (modelId: string) => {
    setSelectedModelId(modelId);
    setSelectedProcessId(null);
    form.setFieldValue('process_id', undefined);
    form.setFieldValue('tact_time', undefined);
    
    // 선택된 모델의 공정 목록 가져오기
    await fetchProcesses(modelId);
  };

  // 공정 선택 핸들러
  const handleProcessSelect = (processId: string) => {
    setSelectedProcessId(processId);
    
    // 선택된 공정의 Tact Time 자동 설정
    const selectedProcess = modelProcesses.find(p => p.id === processId);
    if (selectedProcess) {
      form.setFieldValue('tact_time', selectedProcess.tact_time_seconds);
      
      // Tact Time이 변경되었으므로 용량 재계산
      const operatingHours = form.getFieldValue('daily_operating_hours');
      if (operatingHours) {
        const capacity = calculateDailyCapacity(operatingHours, selectedProcess.tact_time_seconds);
        form.setFieldValue('daily_capacity', capacity);
      }
    }
  };

  // 폼 값 변경 시 자동 계산
  const handleFormValuesChange = (changedValues: Record<string, unknown>, allValues: Record<string, unknown>) => {
    if (changedValues.daily_operating_hours || changedValues.tact_time) {
      const capacity = calculateDailyCapacity(
        allValues.daily_operating_hours || 0,
        allValues.tact_time || 0
      );
      form.setFieldValue('daily_capacity', capacity);
    }
  };

  // 비가동 시간 추가
  const addDowntimeEntry = (values: { start_time: string; end_time?: string; reason: string; category: string }) => {
    const startTime = dayjs(values.start_time);
    const endTime = values.end_time ? dayjs(values.end_time) : dayjs();
    const duration = endTime.diff(startTime, 'minute');

    const newEntry: DowntimeEntry = {
      id: Date.now().toString(),
      machine_id: form.getFieldValue('machine_number') || '',
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      duration_minutes: duration,
      reason: values.reason,
      description: values.description || ''
    };

    setDowntimeEntries(prev => [...prev, newEntry]);
    setDowntimeModalVisible(false);
    downtimeForm.resetFields();
    message.success('비가동 시간이 추가되었습니다');
  };


  // 비가동 시간 삭제
  const removeDowntimeEntry = (id: string) => {
    setDowntimeEntries(prev => prev.filter(entry => entry.id !== id));
    message.success('비가동 시간이 삭제되었습니다');
  };


  // 데이터 저장
  const handleSave = async (values: MachineDataInput) => {
    try {
      setLoading(true);

      // 총 비가동 시간 계산
      const totalDowntime = downtimeEntries.reduce((sum, entry) => sum + (entry.duration_minutes || 0), 0);

      const dataToSave = {
        ...values,
        downtime_minutes: totalDowntime,
        processes: processes,
        downtime_entries: downtimeEntries,
        input_date: dayjs().format('YYYY-MM-DD'),
        shift: getCurrentShift()
      };

      console.log('Saving data:', dataToSave);
      
      // 실제로는 API 호출
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      message.success('데이터가 저장되었습니다');
      form.resetFields();
      setDowntimeEntries([]);
      setProcesses([]);
    } catch (error) {
      console.error('Error saving data:', error);
      message.error('데이터 저장에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  // 현재 교대 계산
  const getCurrentShift = (): 'A' | 'B' => {
    const now = dayjs();
    const hour = now.hour();
    return hour >= 8 && hour < 20 ? 'A' : 'B';
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
      title: '설명',
      dataIndex: 'description',
      key: 'description'
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


  return (
    <div>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        onValuesChange={handleFormValuesChange}
        size="large"
      >
        {/* 기본 정보 */}
        <Card title="설비 기본 정보" size="small" style={{ marginBottom: '16px' }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="machine_name"
                label="설비명"
                rules={[{ required: true, message: '설비명을 입력하세요' }]}
              >
                <Input placeholder="예: CNC-001" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="machine_number"
                label="설비번호"
                rules={[{ required: true, message: '설비번호를 입력하세요' }]}
              >
                <Input placeholder="예: M001" />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 공정 정보 */}
        <Card 
          title="공정 정보" 
          size="small" 
          style={{ marginBottom: '16px' }}
        >
          {/* 모델 및 공정 선택 */}
          <Row gutter={[16, 0]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="model_id"
                label="생산 모델"
                rules={[{ required: true, message: '생산 모델을 선택하세요' }]}
              >
                <Select
                  placeholder="모델을 선택하세요"
                  loading={modelsLoading}
                  onChange={handleModelSelect}
                  showSearch
                  optionFilterProp="children"
                  filterOption={(input, option) =>
                    (option?.children as unknown as string)
                      ?.toLowerCase()
                      .includes(input.toLowerCase()) ?? false
                  }
                  notFoundContent={modelsLoading ? <Spin size="small" /> : '데이터가 없습니다'}
                >
                  {models.map((model) => (
                    <Option key={model.id} value={model.id}>
                      {model.model_name}
                      {model.description && (
                        <span style={{ color: '#8c8c8c', fontSize: '12px' }}>
                          {' '}- {model.description}
                        </span>
                      )}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
              {modelsError && (
                <Alert 
                  message="모델 로딩 오류" 
                  description={modelsError} 
                  type="error" 
                  showIcon 
                  style={{ marginTop: 8 }} 
                />
              )}
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="process_id"
                label="공정 선택"
                rules={[{ required: true, message: '공정을 선택하세요' }]}
              >
                <Select
                  placeholder={selectedModelId ? '공정을 선택하세요' : '먼저 모델을 선택하세요'}
                  loading={processesLoading}
                  onChange={handleProcessSelect}
                  disabled={!selectedModelId}
                  showSearch
                  optionFilterProp="children"
                  filterOption={(input, option) =>
                    (option?.children as unknown as string)
                      ?.toLowerCase()
                      .includes(input.toLowerCase()) ?? false
                  }
                  notFoundContent={
                    processesLoading ? (
                      <Spin size="small" />
                    ) : !selectedModelId ? (
                      '모델을 먼저 선택하세요'
                    ) : (
                      '해당 모델에 공정이 없습니다'
                    )
                  }
                >
                  {modelProcesses.map((process) => (
                    <Option key={process.id} value={process.id}>
                      {process.process_order}. {process.process_name}
                      <span style={{ color: '#8c8c8c', fontSize: '12px' }}>
                        {' '}({process.tact_time_seconds}초)
                      </span>
                    </Option>
                  ))}
                </Select>
              </Form.Item>
              {processesError && (
                <Alert 
                  message="공정 로딩 오류" 
                  description={processesError} 
                  type="error" 
                  showIcon 
                  style={{ marginTop: 8 }} 
                />
              )}
            </Col>
          </Row>
        </Card>

        {/* 생산 정보 */}
        <Card title="생산 정보" size="small" style={{ marginBottom: '16px' }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={12} md={8}>
              <Form.Item
                name="tact_time"
                label={
                  <span>
                    Tact Time (초)
                    {selectedProcessId && (
                      <span style={{ color: '#52c41a', fontSize: '12px', marginLeft: '8px' }}>
                        공정에서 자동 설정됨
                      </span>
                    )}
                  </span>
                }
                rules={[
                  { required: true, message: 'Tact Time을 입력하세요' },
                  { type: 'number', min: 1, message: '1초 이상 입력하세요' }
                ]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  placeholder={selectedProcessId ? '공정에서 자동 설정' : '120'}
                  addonAfter="초"
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item
                name="daily_operating_hours"
                label="일일 기본 가동시간 (시간)"
                rules={[
                  { required: true, message: '일일 가동시간을 입력하세요' },
                  { type: 'number', min: 1, max: 24, message: '1-24시간 사이로 입력하세요' }
                ]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  placeholder="16"
                  addonAfter="시간"
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item
                name="daily_capacity"
                label="일일 생산량(CAPA)"
              >
                <InputNumber
                  style={{ width: '100%' }}
                  placeholder="자동 계산됨"
                  addonAfter="개"
                  readOnly
                  addonBefore={<CalculatorOutlined />}
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 실적 정보 */}
        <Card title="생산 실적" size="small" style={{ marginBottom: '16px' }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="actual_production"
                label="실제 생산량"
                rules={[
                  { required: true, message: '실제 생산량을 입력하세요' },
                  { type: 'number', min: 0, message: '0 이상 입력하세요' }
                ]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  placeholder="480"
                  addonAfter="개"
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="defect_quantity"
                label="불량 수량"
                rules={[
                  { type: 'number', min: 0, message: '0 이상 입력하세요' }
                ]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  placeholder="5"
                  addonAfter="개"
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 비가동 정보 */}
        <Card 
          title="비가동 시간" 
          size="small" 
          style={{ marginBottom: '24px' }}
          extra={
            <Button 
              type="primary" 
              icon={<ClockCircleOutlined />} 
              size="small"
              onClick={() => setDowntimeModalVisible(true)}
            >
              비가동 시간 추가
            </Button>
          }
        >
          <Table
            dataSource={downtimeEntries}
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
                  <Text strong>
                    {downtimeEntries.reduce((sum, entry) => sum + (entry.duration_minutes || 0), 0)}분
                  </Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} colSpan={3} />
              </Table.Summary.Row>
            )}
          />
        </Card>

        {/* 저장 버튼 */}
        <div style={{ textAlign: 'center' }}>
          <Space>
            <Button onClick={() => form.resetFields()}>
              초기화
            </Button>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              icon={<SaveOutlined />}
              size="large"
            >
              데이터 저장
            </Button>
          </Space>
        </div>
      </Form>

      {/* 비가동 시간 추가 모달 */}
      <Modal
        title="비가동 시간 추가"
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
            <DatePicker
              showTime
              style={{ width: '100%' }}
              placeholder="시작 시간 선택"
            />
          </Form.Item>
          
          <Form.Item
            name="end_time"
            label="종료 시간"
          >
            <DatePicker
              showTime
              style={{ width: '100%' }}
              placeholder="종료 시간 선택 (현재 시간 기본)"
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

export default DataInputForm;