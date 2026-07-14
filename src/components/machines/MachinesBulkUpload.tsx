'use client';

import React, { useState } from 'react';
import {
  Upload,
  Button,
  Steps,
  Table,
  Alert,
  Space,
  Typography,
  Card,
  Row,
  Col,
  Tag,
  App,
  Spin
} from 'antd';
import {
  UploadOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  SaveOutlined,
  EyeOutlined,
  FileExcelOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd/es/upload/interface';
import { useAdminTranslation } from '@/hooks/useTranslation';

const { Title, Text, Paragraph } = Typography;

interface ValidationError {
  row: number;
  field: string;
  message: string;
  value: unknown;
}

interface PreviewData {
  name: string;
  location: string | null;
  equipment_type: string | null;
  production_model_name: string;
  process_name: string;
  is_active: boolean;
  current_state: string;
}

interface UploadResult {
  success: boolean;
  message: string;
  inserted_count?: number;
  validation_errors?: ValidationError[];
  duplicate_names?: string[];
  total_rows?: number;
  valid_rows?: number;
  error_rows?: number;
  preview_data?: PreviewData[];
  warnings?: string[];
  inserted_machines?: unknown[];
}

const MachinesBulkUpload: React.FC = () => {
  const { message } = App.useApp();
  const { t } = useAdminTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  // Preview modal state kept for future implementation
  // const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData[]>([]);
  const [confirming, setConfirming] = useState(false);

  // 템플릿 다운로드
  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/admin/machines/template');
      
      if (!response.ok) {
        throw new Error('템플릿 다운로드에 실패했습니다.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // 파일명 추출
      const contentDisposition = response.headers.get('Content-Disposition');
      const filename = contentDisposition 
        ? contentDisposition.split('filename=')[1]?.replace(/"/g, '')
        : '설비등록_템플릿.xlsx';
      
      link.download = decodeURIComponent(filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      message.success(t('bulkUpload.messages.templateDownloaded'));
    } catch (error) {
      console.error('Template download error:', error);
      message.error(t('bulkUpload.messages.templateDownloadError'));
    }
  };

  // 미리보기 처리
  const handlePreview = async () => {
    if (fileList.length === 0) {
      message.error(t('bulkUpload.messages.selectFileFirst'));
      return;
    }

    const formData = new FormData();
    formData.append('file', fileList[0].originFileObj as File);
    formData.append('preview', 'true');

    setUploading(true);
    setUploadResult(null);
    setValidationErrors([]);

    try {
      const response = await fetch('/api/admin/machines/bulk-upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      setUploadResult(result);

      if (result.success && result.preview_data) {
        setPreviewData(result.preview_data);
        setCurrentStep(1); // 검증/미리보기 단계로 이동
        message.success(t('bulkUpload.messages.previewSuccess'));
      } else {
        if (result.validation_errors) {
          setValidationErrors(result.validation_errors);
          setCurrentStep(1); // 검증 결과 단계로 이동
        }
        message.error(result.error || t('bulkUpload.messages.previewError'));
      }
    } catch (error) {
      console.error('Preview error:', error);
      message.error(t('bulkUpload.messages.previewCatchError'));
    } finally {
      setUploading(false);
    }
  };

  // 파일 업로드 처리 (실제 등록)
  const handleUpload = async () => {
    if (fileList.length === 0) {
      message.error(t('bulkUpload.messages.selectFileFirst'));
      return;
    }

    const formData = new FormData();
    formData.append('file', fileList[0].originFileObj as File);

    setConfirming(true);
    setUploadResult(null);

    try {
      const response = await fetch('/api/admin/machines/bulk-upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      setUploadResult(result);

      if (result.success) {
        message.success(result.message);
        setCurrentStep(2); // 완료 단계로 이동
      } else {
        if (result.validation_errors) {
          setValidationErrors(result.validation_errors);
        }
        message.error(result.error || t('bulkUpload.messages.uploadError'));
      }
    } catch (error) {
      console.error('Upload error:', error);
      message.error(t('bulkUpload.messages.uploadCatchError'));
    } finally {
      setConfirming(false);
    }
  };

  // 파일 선택 처리
  const uploadProps: UploadProps = {
    accept: '.xlsx,.xls',
    maxCount: 1,
    fileList,
    onChange: ({ fileList: newFileList }) => {
      setFileList(newFileList);
      setUploadResult(null);
      setValidationErrors([]);
      setPreviewData([]);
      setCurrentStep(0);
    },
    beforeUpload: (file) => {
      const isValidType = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
      ].includes(file.type);
      
      if (!isValidType) {
        message.error(t('bulkUpload.messages.invalidFileType'));
        return false;
      }

      const isValidSize = file.size / 1024 / 1024 < 10; // 10MB
      if (!isValidSize) {
        message.error(t('bulkUpload.messages.fileSizeExceeded'));
        return false;
      }

      return false; // 자동 업로드 방지
    },
    onRemove: () => {
      setFileList([]);
      setUploadResult(null);
      setValidationErrors([]);
      setPreviewData([]);
      setCurrentStep(0);
    }
  };

  // 검증 오류 테이블 컬럼
  const errorColumns = [
    {
      title: t('bulkUpload.columns.row'),
      dataIndex: 'row',
      key: 'row',
      width: 80,
      sorter: (a: ValidationError, b: ValidationError) => a.row - b.row,
    },
    {
      title: t('bulkUpload.columns.field'),
      dataIndex: 'field',
      key: 'field',
      width: 120,
    },
    {
      title: t('bulkUpload.columns.message'),
      dataIndex: 'message',
      key: 'message',
      width: 300,
    },
    {
      title: t('bulkUpload.columns.value'),
      dataIndex: 'value',
      key: 'value',
      width: 150,
      render: (value: unknown) => (
        <Text code style={{ fontSize: '12px' }}>
          {value === null || value === undefined ? t('bulkUpload.columns.emptyValue') : String(value)}
        </Text>
      ),
    },
  ];

  // 미리보기 데이터 테이블 컬럼
  const previewColumns = [
    {
      title: t('machineManagement.form.machineName'),
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: t('machineManagement.form.location'),
      dataIndex: 'location',
      key: 'location',
      width: 150,
    },
    {
      title: t('bulkUpload.columns.equipmentType'),
      dataIndex: 'equipment_type',
      key: 'equipment_type',
      width: 120,
    },
    {
      title: t('machineManagement.form.productionModel'),
      dataIndex: 'production_model_name',
      key: 'production_model_name',
      width: 120,
    },
    {
      title: t('machineManagement.form.process'),
      dataIndex: 'process_name',
      key: 'process_name',
      width: 100,
    },
    {
      title: t('bulkUpload.columns.activeStatus'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (value: boolean) => (
        <Tag color={value ? 'green' : 'red'}>
          {value ? t('common.active') : t('common.inactive')}
        </Tag>
      ),
    },
    {
      title: t('bulkUpload.columns.currentState'),
      dataIndex: 'current_state',
      key: 'current_state',
      width: 120,
      render: (value: string) => {
        const colorMap: Record<string, string> = {
          'NORMAL_OPERATION': 'green',
          'INSPECTION': 'orange',
          'BREAKDOWN_REPAIR': 'red',
          'PM_MAINTENANCE': 'orange',
          'MODEL_CHANGE': 'blue',
          'PLANNED_STOP': 'purple',
          'PROGRAM_CHANGE': 'cyan',
          'TOOL_CHANGE': 'magenta',
          'TEMPORARY_STOP': 'red',
        };
        const color = colorMap[value] || 'default';
        const text = t(`machines:states.${value}`, { defaultValue: value });
        return <Tag color={color}>{text}</Tag>;
      },
    },
  ];

  // 재시작
  const handleRestart = () => {
    setFileList([]);
    setUploadResult(null);
    setValidationErrors([]);
    setPreviewData([]);
    setCurrentStep(0);
  };

  const steps = [
    {
      title: t('bulkUpload.steps.selectFile.title'),
      description: t('bulkUpload.steps.selectFile.description'),
      icon: <UploadOutlined />,
    },
    {
      title: t('bulkUpload.steps.preview.title'),
      description: t('bulkUpload.steps.preview.description'),
      icon: <EyeOutlined />,
    },
    {
      title: t('bulkUpload.steps.complete.title'),
      description: t('bulkUpload.steps.complete.description'),
      icon: <CheckCircleOutlined />,
    },
  ];

  return (
    <Card>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <Title level={3}>
            <FileExcelOutlined style={{ marginRight: 8 }} />
            {t('bulkUpload.title')}
          </Title>
          <Paragraph type="secondary">
            {t('bulkUpload.description')}
          </Paragraph>
        </div>

        <Steps current={currentStep} items={steps} style={{ marginBottom: 32 }} />

        {/* 단계 0: 파일 선택 */}
        {currentStep === 0 && (
          <div>
            <Row gutter={24}>
              <Col xs={24} md={12}>
                <Card title={t('bulkUpload.cards.downloadTemplate')} size="small" style={{ marginBottom: 16 }}>
                  <Paragraph>
                    {t('bulkUpload.instructions.downloadFirst')}
                  </Paragraph>
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={handleDownloadTemplate}
                  >
                    {t('bulkUpload.buttons.downloadTemplate')}
                  </Button>
                </Card>
              </Col>

              <Col xs={24} md={12}>
                <Card title={t('bulkUpload.cards.uploadFile')} size="small" style={{ marginBottom: 16 }}>
                  <Paragraph>
                    {t('bulkUpload.instructions.uploadFile')}
                  </Paragraph>
                  <Upload.Dragger {...uploadProps} style={{ marginBottom: 16 }}>
                    <p className="ant-upload-drag-icon">
                      <UploadOutlined />
                    </p>
                    <p className="ant-upload-text">
                      {t('bulkUpload.upload.dragText')}
                    </p>
                    <p className="ant-upload-hint">
                      {t('bulkUpload.upload.hint')}
                    </p>
                  </Upload.Dragger>
                </Card>
              </Col>
            </Row>

            {fileList.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Space>
                  <Button
                    type="default"
                    size="large"
                    loading={uploading}
                    onClick={handlePreview}
                    icon={<EyeOutlined />}
                  >
                    {t('bulkUpload.buttons.preview')}
                  </Button>
                </Space>
              </div>
            )}
          </div>
        )}

        {/* 단계 1: 데이터 미리보기/검증 결과 */}
        {currentStep === 1 && uploadResult && (
          <div>
            {/* 성공적인 미리보기 */}
            {uploadResult.success && previewData.length > 0 && (
              <div>
                <Alert
                  message={t('bulkUpload.alerts.previewTitle')}
                  description={t('bulkUpload.alerts.previewDescription', { count: uploadResult.total_rows })}
                  type="success"
                  showIcon
                  style={{ marginBottom: 16 }}
                />

                {uploadResult.warnings && uploadResult.warnings.length > 0 && (
                  <Alert
                    message={t('bulkUpload.alerts.warningTitle')}
                    description={
                      <ul>
                        {uploadResult.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    }
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                )}

                <Card title={t('bulkUpload.cards.previewList')} style={{ marginBottom: 16 }}>
                  <Table
                    columns={previewColumns}
                    dataSource={previewData}
                    rowKey="name"
                    size="small"
                    pagination={{
                      pageSize: 10,
                      showSizeChanger: true,
                      showTotal: (total) => t('common:pagination.totalMachines', { total }),
                    }}
                    scroll={{ x: 1000 }}
                  />
                </Card>

                <Space>
                  <Button
                    type="primary"
                    size="large"
                    loading={confirming}
                    onClick={handleUpload}
                    icon={<SaveOutlined />}
                  >
                    {t('bulkUpload.buttons.confirmUpload')}
                  </Button>
                  <Button onClick={handleRestart} icon={<ReloadOutlined />}>
                    {t('bulkUpload.buttons.restart')}
                  </Button>
                </Space>
              </div>
            )}

            {/* 검증 오류 */}
            {!uploadResult.success && (
              <div>
                <Alert
                  message={t('bulkUpload.alerts.validationErrorTitle')}
                  description={t('bulkUpload.alerts.validationErrorDescription', {
                    totalRows: uploadResult.total_rows,
                    errorRows: uploadResult.error_rows,
                  })}
                  type="error"
                  showIcon
                  style={{ marginBottom: 16 }}
                />

                {uploadResult.duplicate_names && uploadResult.duplicate_names.length > 0 && (
                  <Alert
                    message={t('bulkUpload.alerts.duplicateNamesTitle')}
                    description={
                      <div>
                        <p>{t('bulkUpload.alerts.duplicateNamesDescription')}</p>
                        <div style={{ marginTop: 8 }}>
                          {uploadResult.duplicate_names.map((name: string) => (
                            <Tag key={name} color="red" style={{ margin: '2px' }}>
                              {name}
                            </Tag>
                          ))}
                        </div>
                      </div>
                    }
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                )}

                {validationErrors.length > 0 && (
                  <Card title={t('bulkUpload.cards.errorDetail')} style={{ marginBottom: 16 }}>
                    <Table
                      columns={errorColumns}
                      dataSource={validationErrors}
                      rowKey={(record) => `${record.row}-${record.field}`}
                      size="small"
                      pagination={{
                        pageSize: 10,
                        showSizeChanger: true,
                        showTotal: (total) => t('common:pagination.totalErrors', { total }),
                      }}
                      scroll={{ x: 700 }}
                    />
                  </Card>
                )}

                <Space>
                  <Button onClick={handleRestart} icon={<ReloadOutlined />}>
                    {t('bulkUpload.buttons.restart')}
                  </Button>
                </Space>
              </div>
            )}
          </div>
        )}

        {/* 단계 2: 완료 */}
        {currentStep === 2 && uploadResult && uploadResult.success && (
          <div>
            <Alert
              message={t('bulkUpload.alerts.completeTitle')}
              description={
                <div>
                  <p>{uploadResult.message}</p>
                  <p>{t('bulkUpload.alerts.insertedCountLabel')}: <strong>{uploadResult.inserted_count}{t('bulkUpload.units.piece')}</strong></p>
                </div>
              }
              type="success"
              showIcon
              style={{ marginBottom: 16 }}
            />

            <Space>
              <Button type="primary" onClick={handleRestart} icon={<ReloadOutlined />}>
                {t('bulkUpload.buttons.registerNew')}
              </Button>
            </Space>
          </div>
        )}

        {/* 로딩 상태 */}
        {(uploading || confirming) && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>
              <Text>
                {uploading && t('bulkUpload.loading.analyzing')}
                {confirming && t('bulkUpload.loading.registering')}
              </Text>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

export default MachinesBulkUpload;