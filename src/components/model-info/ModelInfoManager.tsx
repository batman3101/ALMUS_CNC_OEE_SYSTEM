'use client';

import React, { useState, useEffect } from 'react';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Space,
  message,
  Popconfirm,
  Typography,
  Tag,
  Row,
  Col,
  Select,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SettingOutlined
} from '@ant-design/icons';
import { createSupabaseClient } from '@/lib/supabase';
import { authFetch } from '@/lib/authFetch';
import { useModelInfoTranslation } from '@/hooks/useTranslation';
import type { ProductModel, ModelProcess } from '@/types/modelInfo';
import { useFailureReport } from '@/hooks/useFailureReport';
import { compareDate, compareNullableNumber, compareText, type SortOrder } from '@/utils/tableSorters';

/**
 * 마스터 쓰기는 서버 API 만 거친다.
 *
 * 브라우저에서 `supabase.from('product_models').update(...)` 로 직접 쓰던 시절에는 규칙이
 * 두 벌이었다 — API 는 admin/engineer 를 요구하고 계정 활성 여부도 봤지만, 실제로 쓰이던
 * 경로(PostgREST + RLS)는 역할만 보고 `is_active` 를 보지 않았다. 규칙이 둘이면 **약한 쪽이
 * 진짜 규칙**이 된다. 읽기는 그대로 RLS 아래에서 하고, 쓰기만 서버로 모은다.
 */
class MasterWriteError extends Error {
  constructor(readonly kind: 'duplicate' | 'failed') {
    super(kind);
    this.name = 'MasterWriteError';
  }
}

async function writeMaster(url: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) {
  const response = await authFetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });

  if (response.ok) return;

  // 이름 중복은 사용자가 고칠 수 있는 입력 오류라 별도로 구분한다.
  if (response.status === 409) throw new MasterWriteError('duplicate');
  throw new MasterWriteError('failed');
}

const { Title, Text } = Typography;
const { TextArea } = Input;

type ModelInfoManagerProps = Record<string, never>;

const ModelInfoManager: React.FC<ModelInfoManagerProps> = () => {
  const reportFailure = useFailureReport();
  const { t } = useModelInfoTranslation();
  const [models, setModels] = useState<ProductModel[]>([]);
  const [processes, setProcesses] = useState<ModelProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [modelModalVisible, setModelModalVisible] = useState(false);
  const [processModalVisible, setProcessModalVisible] = useState(false);
  const [editingModel, setEditingModel] = useState<ProductModel | null>(null);
  const [editingProcess, setEditingProcess] = useState<ModelProcess | null>(null);
  const [selectedModel, setSelectedModel] = useState<ProductModel | null>(null);
  const [modelForm] = Form.useForm();
  const [processForm] = Form.useForm();

  const supabase = createSupabaseClient();

  // 모델 목록 조회
  const fetchModels = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('product_models')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setModels(data || []);
    } catch (error) {
      console.error('모델 조회 오류:', error);
      reportFailure(t('messages.modelLoadFailed'), error);
    } finally {
      setLoading(false);
    }
  };

  // 공정 목록 조회
  const fetchProcesses = async (modelId?: string) => {
    try {
      let query = supabase
        .from('model_processes')
        .select(`
          *,
          product_models!inner(model_name)
        `)
        .order('process_order', { ascending: true });

      if (modelId) {
        query = query.eq('model_id', modelId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setProcesses(data || []);
    } catch (error) {
      console.error('공정 조회 오류:', error);
      reportFailure(t('에러.공정목록조회실패'), error);
    }
  };

  useEffect(() => {
    fetchModels();
    fetchProcesses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 모델 저장
  const handleSaveModel = async (values: { model_name: string; description?: string }) => {
    try {
      const payload = {
        model_name: values.model_name,
        description: values.description
      };

      if (editingModel) {
        await writeMaster(`/api/product-models/${editingModel.id}`, 'PUT', payload);
        message.success(t('messages.modelUpdated'));
      } else {
        await writeMaster('/api/product-models', 'POST', payload);
        message.success(t('messages.modelAdded'));
      }

      setModelModalVisible(false);
      setEditingModel(null);
      modelForm.resetFields();
      fetchModels();
    } catch (error: unknown) {
      console.error('모델 저장 오류:', error);
      if (error instanceof MasterWriteError && error.kind === 'duplicate') {
        message.error(t('messages.modelNameExists'));
      } else {
        reportFailure(t('messages.modelSaveFailed'), error);
      }
    }
  };

  // 공정 저장
  const handleSaveProcess = async (values: { process_name: string; tact_time_seconds: number; process_order?: number; cavity_count?: number }) => {
    try {
      if (editingProcess) {
        await writeMaster(`/api/model-processes/${editingProcess.id}`, 'PUT', {
          process_name: values.process_name,
          tact_time_seconds: values.tact_time_seconds,
          process_order: values.process_order,
          cavity_count: values.cavity_count || 1
        });
        message.success(t('메시지.공정수정완료'));
      } else {
        if (!selectedModel) {
          message.error(t('에러.모델선택필요'));
          return;
        }

        await writeMaster('/api/model-processes', 'POST', {
          model_id: selectedModel.id,
          process_name: values.process_name,
          tact_time_seconds: values.tact_time_seconds,
          process_order: values.process_order || 1,
          cavity_count: values.cavity_count || 1
        });
        message.success(t('메시지.공정생성완료'));
      }

      setProcessModalVisible(false);
      setEditingProcess(null);
      processForm.resetFields();
      fetchProcesses();
    } catch (error: unknown) {
      console.error('공정 저장 오류:', error);
      if (error instanceof MasterWriteError && error.kind === 'duplicate') {
        message.error(t('에러.중복공정명'));
      } else {
        reportFailure(t('에러.공정저장실패'), error);
      }
    }
  };

  // 모델 삭제 (서버에서 비활성화 — 과거 기록이 이 모델을 가리키므로 행은 남긴다)
  const handleDeleteModel = async (id: string) => {
    try {
      await writeMaster(`/api/product-models/${id}`, 'DELETE');
      message.success(t('모델삭제완료'));
      fetchModels();
    } catch (error) {
      console.error('모델 삭제 오류:', error);
      reportFailure(t('에러.모델삭제실패'), error);
    }
  };

  // 공정 삭제
  const handleDeleteProcess = async (id: string) => {
    try {
      await writeMaster(`/api/model-processes/${id}`, 'DELETE');
      message.success(t('공정삭제완료'));
      fetchProcesses();
    } catch (error) {
      console.error('공정 삭제 오류:', error);
      reportFailure(t('에러.공정삭제실패'), error);
    }
  };

  // 모델 편집 모달 열기
  const openModelModal = (model?: ProductModel) => {
    setEditingModel(model || null);
    if (model) {
      modelForm.setFieldsValue(model);
    } else {
      modelForm.resetFields();
    }
    setModelModalVisible(true);
  };

  // 공정 편집 모달 열기
  const openProcessModal = (process?: ModelProcess) => {
    setEditingProcess(process || null);
    if (process) {
      processForm.setFieldsValue(process);
    } else {
      processForm.resetFields();
      // 기본값 설정
      processForm.setFieldsValue({
        process_order: processes.length + 1,
        cavity_count: 1
      });
    }
    setProcessModalVisible(true);
  };

  // 모델 테이블 컬럼
  const modelColumns = [
    {
      title: t('컬럼.모델명'),
      dataIndex: 'model_name',
      key: 'model_name',
      sorter: (a: ProductModel, b: ProductModel, order?: SortOrder) =>
        compareText(a.model_name, b.model_name, order),
      render: (text: string) => <Text strong>{text}</Text>
    },
    {
      title: t('컬럼.설명'),
      dataIndex: 'description',
      key: 'description',
      // 설명이 비어 있는 모델은 방향과 무관하게 맨 뒤로 — 채워진 것부터 보게 한다.
      sorter: (a: ProductModel, b: ProductModel, order?: SortOrder) =>
        compareText(a.description, b.description, order),
      render: (text: string) => text || '-'
    },
    {
      title: t('컬럼.공정수'),
      key: 'process_count',
      // 표시값과 같은 식으로 센다 — 화면 숫자와 정렬 기준이 어긋나면 안 된다.
      sorter: (a: ProductModel, b: ProductModel, order?: SortOrder) =>
        compareNullableNumber(
          processes.filter(p => p.model_id === a.id).length,
          processes.filter(p => p.model_id === b.id).length,
          order
        ),
      render: (_: unknown, record: ProductModel) => {
        const count = processes.filter(p => p.model_id === record.id).length;
        return <Tag color={count > 0 ? 'blue' : 'default'}>{t('단위.개값', { n: count })}</Tag>;
      }
    },
    {
      title: t('컬럼.등록일'),
      dataIndex: 'created_at',
      key: 'created_at',
      sorter: (a: ProductModel, b: ProductModel, order?: SortOrder) =>
        compareDate(a.created_at, b.created_at, order),
      render: (date: string) => new Date(date).toLocaleDateString('ko-KR')
    },
    {
      title: t('컬럼.작업'),
      key: 'actions',
      render: (_: unknown, record: ProductModel) => (
        <Space>
          <Button
            type="link"
            icon={<SettingOutlined />}
            onClick={() => {
              setSelectedModel(record);
              fetchProcesses(record.id);
            }}
            size="small"
          >
            {t('버튼.공정관리')}
          </Button>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openModelModal(record)}
            size="small"
          >
            {t('버튼.수정')}
          </Button>
          <Popconfirm
            title={t('확인.모델삭제')}
            description={t('확인.모델삭제설명')}
            onConfirm={() => handleDeleteModel(record.id)}
            okText={t('확인.삭제')}
            cancelText={t('확인.취소')}
          >
            <Button type="link" danger icon={<DeleteOutlined />} size="small">
              {t('버튼.삭제')}
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  // 공정 테이블 컬럼
  const processColumns = [
    {
      title: t('컬럼.순서'),
      dataIndex: 'process_order',
      key: 'process_order',
      width: 80,
      sorter: (a: ModelProcess, b: ModelProcess, order?: SortOrder) =>
        compareNullableNumber(a.process_order, b.process_order, order),
      defaultSortOrder: 'ascend' as const,
      render: (order: number) => <Tag color="blue">{order}</Tag>
    },
    {
      title: t('컬럼.공정명'),
      dataIndex: 'process_name',
      key: 'process_name',
      sorter: (a: ModelProcess, b: ModelProcess, order?: SortOrder) =>
        compareText(a.process_name, b.process_name, order),
      render: (text: string) => <Text strong>{text}</Text>
    },
    {
      title: 'Tact Time',
      dataIndex: 'tact_time_seconds',
      key: 'tact_time_seconds',
      // ⚠️ 개당 초다(사이클당이 아니다). 정렬은 저장된 값 그대로 비교한다 —
      // cavity_count 로 나누지 않는다(CLAUDE.md 의 per-piece 규약).
      sorter: (a: ModelProcess, b: ModelProcess, order?: SortOrder) =>
        compareNullableNumber(a.tact_time_seconds, b.tact_time_seconds, order),
      render: (seconds: number) => t('단위.초값', { n: seconds })
    },
    {
      title: t('컬럼.캐비티수'),
      dataIndex: 'cavity_count',
      key: 'cavity_count',
      width: 100,
      // 표시가 `count || 1` 이므로 정렬도 같은 기본값을 써야 화면과 순서가 맞는다.
      sorter: (a: ModelProcess, b: ModelProcess, order?: SortOrder) =>
        compareNullableNumber(a.cavity_count || 1, b.cavity_count || 1, order),
      render: (count: number) => <Tag color="green">{count || 1}</Tag>
    },
    {
      title: t('컬럼.모델'),
      key: 'model_name',
      sorter: (a: ModelProcess, b: ModelProcess, order?: SortOrder) =>
        compareText(a.product_models?.model_name, b.product_models?.model_name, order),
      render: (record: ModelProcess) => record.product_models?.model_name || '-'
    },
    {
      title: t('컬럼.작업'),
      key: 'actions',
      render: (_: unknown, record: ModelProcess) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openProcessModal(record)}
            size="small"
          >
            {t('버튼.수정')}
          </Button>
          <Popconfirm
            title={t('확인.공정삭제')}
            onConfirm={() => handleDeleteProcess(record.id)}
            okText={t('확인.삭제')}
            cancelText={t('확인.취소')}
          >
            <Button type="link" danger icon={<DeleteOutlined />} size="small">
              {t('버튼.삭제')}
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      {/* 모델 관리 */}
      <Card
        title={
          <div>
            <Title level={4} style={{ margin: 0 }}>
              {t('생산모델관리')}
            </Title>
            <Text type="secondary">{t('생산모델설명')}</Text>
          </div>
        }
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openModelModal()}
          >
            {t('버튼.모델추가')}
          </Button>
        }
        style={{ marginBottom: '24px' }}
      >
        <Table
          dataSource={models}
          columns={modelColumns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* 공정 관리 */}
      <Card
        title={
          <div>
            <Title level={4} style={{ margin: 0 }}>
              {t('공정관리')}
            </Title>
            <Text type="secondary">
              {selectedModel 
                ? t('선택된모델공정설명', { modelName: selectedModel.model_name })
                : t('공정설명')
              }
            </Text>
          </div>
        }
        extra={
          <Space>
            {selectedModel && (
              <Tag color="green">{t('선택된모델')}: {selectedModel.model_name}</Tag>
            )}
            <Select
              placeholder={t('placeholders.selectModel')}
              style={{ width: 200 }}
              value={selectedModel?.id}
              onChange={(value) => {
                const model = models.find(m => m.id === value);
                setSelectedModel(model || null);
                if (value) {
                  fetchProcesses(value);
                } else {
                  fetchProcesses(); // 전체 공정 조회
                }
              }}
              allowClear
              onClear={() => {
                setSelectedModel(null);
                fetchProcesses();
              }}
            >
              {models.map(model => (
                <Select.Option key={model.id} value={model.id}>
                  {model.model_name}
                </Select.Option>
              ))}
            </Select>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => openProcessModal()}
              disabled={!selectedModel}
            >
              {t('버튼.공정추가')}
            </Button>
          </Space>
        }
      >
        <Table
          dataSource={selectedModel ? processes.filter(p => p.model_id === selectedModel.id) : processes}
          columns={processColumns}
          rowKey="id"
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* 모델 추가/수정 모달 */}
      <Modal
        title={editingModel ? t('modal.editModelTitle') : t('modal.addModelTitle')}
        open={modelModalVisible}
        onCancel={() => {
          setModelModalVisible(false);
          setEditingModel(null);
          modelForm.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form
          form={modelForm}
          layout="vertical"
          onFinish={handleSaveModel}
        >
          <Form.Item
            name="model_name"
            label={t('fields.modelName')}
            rules={[
              { required: true, message: t('validation.modelNameRequired') },
              { min: 2, message: t('validation.modelNameMinLength') }
            ]}
          >
            <Input placeholder={t('placeholders.modelName')} />
          </Form.Item>

          <Form.Item
            name="description"
            label={t('fields.description')}
          >
            <TextArea
              rows={3}
              placeholder={t('placeholders.description')}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => {
                setModelModalVisible(false);
                setEditingModel(null);
                modelForm.resetFields();
              }}>
                {t('buttons.cancel')}
              </Button>
              <Button type="primary" htmlType="submit">
                {editingModel ? t('buttons.edit') : t('buttons.add')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 공정 추가/수정 모달 */}
      <Modal
        title={editingProcess ? t('모달.공정수정') : t('모달.공정추가')}
        open={processModalVisible}
        onCancel={() => {
          setProcessModalVisible(false);
          setEditingProcess(null);
          processForm.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form
          form={processForm}
          layout="vertical"
          onFinish={handleSaveProcess}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="process_name"
                label={t('라벨.공정명')}
                rules={[
                  { required: true, message: t('검증.공정명필수') }
                ]}
              >
                <Input placeholder={t('라벨.공정명')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="process_order"
                label={t('라벨.공정순서')}
                rules={[
                  { required: true, message: t('검증.공정순서필수') },
                  { type: 'number', min: 1, message: t('검증.캐비티수최소값') }
                ]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  placeholder="1"
                  min={1}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="tact_time_seconds"
            label={t('라벨.택트타임초')}
            rules={[
              { required: true, message: t('검증.택트타임필수') },
              { type: 'number', min: 1, message: t('검증.캐비티수최소값') }
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="120"
              min={1}
              addonAfter={t('단위.초')}
            />
          </Form.Item>

          <Form.Item
            name="cavity_count"
            label={t('라벨.캐비티수')}
            rules={[
              { required: true, message: t('검증.캐비티수필수') },
              { type: 'number', min: 1, message: t('검증.캐비티수최소값') }
            ]}
            initialValue={1}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="1"
              min={1}
              precision={0}
              addonAfter={t('단위.개')}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => {
                setProcessModalVisible(false);
                setEditingProcess(null);
                processForm.resetFields();
              }}>
                {t('버튼.취소')}
              </Button>
              <Button type="primary" htmlType="submit">
                {editingProcess ? t('버튼.수정') : t('버튼.추가')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ModelInfoManager;