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
  Popconfirm
} from 'antd';
import {
  SaveOutlined,
  PlusOutlined,
  DeleteOutlined,
  CalculatorOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import type { MachineDataInput, DowntimeEntry, MachineProcess } from '@/types/dataInput';

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

const DataInputForm: React.FC = () => {
  const { t } = useLanguage();
  const { getSetting } = useSystemSettings();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [downtimeEntries, setDowntimeEntries] = useState<DowntimeEntry[]>([]);
  const [processes, setProcesses] = useState<MachineProcess[]>([]);
  const [downtimeModalVisible, setDowntimeModalVisible] = useState(false);
  const [processModalVisible, setProcessModalVisible] = useState(false);
  const [downtimeForm] = Form.useForm();
  const [processForm] = Form.useForm();

  // 비가동 사유 목록 가져오기
  const downtimeReasons = getSetting('general', 'downtime_reasons') || [
    '설비 고장', '금형 교체', '자재 부족', '품질 불량', '계획 정지', '청소/정리', '기타'
  ];

  // 일일 생산량(CAPA) 자동 계산
  const calculateDailyCapacity = (operatingHours: number, tactTime: number) => {
    if (!operatingHours || !tactTime) return 0;
    return Math.floor((operatingHours * 3600) / tactTime); // 시간을 초로 변환 후 계산
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

  // 공정 추가
  const addProcess = (values: { process_name: string; description?: string; standard_time?: number }) => {
    const newProcess: MachineProcess = {
      id: Date.now().toString(),
      machine_id: form.getFieldValue('machine_number') || '',
      process_order: processes.length + 1,
      process_name: values.process_name,
      description: values.description || '',
      standard_time: values.standard_time || 0
    };

    setProcesses(prev => [...prev, newProcess]);
    setProcessModalVisible(false);
    processForm.resetFields();
    message.success('공정이 추가되었습니다');
  };

  // 비가동 시간 삭제
  const removeDowntimeEntry = (id: string) => {
    setDowntimeEntries(prev => prev.filter(entry => entry.id !== id));
    message.success('비가동 시간이 삭제되었습니다');
  };

  // 공정 삭제
  const removeProcess = (id: string) => {
    setProcesses(prev => prev.filter(process => process.id !== id));
    message.success('공정이 삭제되었습니다');
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

  // 공정 테이블 컬럼
  const processColumns = [
    {
      title: '순서',
      dataIndex: 'process_order',
      key: 'process_order'
    },
    {
      title: '공정명',
      dataIndex: 'process_name',
      key: 'process_name'
    },
    {
      title: '설명',
      dataIndex: 'description',
      key: 'description'
    },
    {
      title: '표준 시간(초)',
      dataIndex: 'standard_time',
      key: 'standard_time'
    },
    {
      title: '작업',
      key: 'actions',
      render: (_: any, record: MachineProcess) => (
        <Popconfirm
          title="이 공정을 삭제하시겠습니까?"
          onConfirm={() => removeProcess(record.id!)}
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
            <Col xs={24} sm={12} md={8}>
              <Form.Item
                name="machine_name"
                label="설비명"
                rules={[{ required: true, message: '설비명을 입력하세요' }]}
              >
                <Input placeholder="예: CNC-001" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item
                name="machine_number"
                label="설비번호"
                rules={[{ required: true, message: '설비번호를 입력하세요' }]}
              >
                <Input placeholder="예: M001" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item
                name="model_type"
                label="모델"
                rules={[{ required: true, message: '모델을 입력하세요' }]}
              >
                <Input placeholder="예: MAZAK-VTC-200" />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* 공정 정보 */}
        <Card 
          title="공정 정보" 
          size="small" 
          style={{ marginBottom: '16px' }}
          extra={
            <Button 
              type="primary" 
              icon={<PlusOutlined />} 
              size="small"
              onClick={() => setProcessModalVisible(true)}
            >
              공정 추가
            </Button>
          }
        >
          <Table
            dataSource={processes}
            columns={processColumns}
            rowKey="id"
            size="small"
            pagination={false}
            locale={{ emptyText: '등록된 공정이 없습니다' }}
          />
        </Card>

        {/* 생산 정보 */}
        <Card title="생산 정보" size="small" style={{ marginBottom: '16px' }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={12} md={8}>
              <Form.Item
                name="tact_time"
                label="Tact Time (초)"
                rules={[
                  { required: true, message: 'Tact Time을 입력하세요' },
                  { type: 'number', min: 1, message: '1초 이상 입력하세요' }
                ]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  placeholder="120"
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

      {/* 공정 추가 모달 */}
      <Modal
        title="공정 추가"
        open={processModalVisible}
        onCancel={() => setProcessModalVisible(false)}
        footer={null}
      >
        <Form
          form={processForm}
          layout="vertical"
          onFinish={addProcess}
        >
          <Form.Item
            name="process_name"
            label="공정명"
            rules={[{ required: true, message: '공정명을 입력하세요' }]}
          >
            <Input placeholder="예: 조립, 가공, 검사" />
          </Form.Item>

          <Form.Item
            name="description"
            label="공정 설명"
          >
            <TextArea
              rows={2}
              placeholder="공정에 대한 상세 설명"
            />
          </Form.Item>

          <Form.Item
            name="standard_time"
            label="표준 시간 (초)"
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="60"
              addonAfter="초"
              min={0}
            />
          </Form.Item>

          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setProcessModalVisible(false)}>
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