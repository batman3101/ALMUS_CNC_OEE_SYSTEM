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
  Progress,
  Divider,
  Tag,
  Modal,
  App,
  Spin
} from 'antd';
import {
  UploadOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  SaveOutlined,
  EyeOutlined,
  FileExcelOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd/es/upload/interface';

const { Title, Text, Paragraph } = Typography;
const { Step } = Steps;

interface ValidationError {
  row: number;
  field: string;
  message: string;
  value: any;
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
}

const MachinesBulkUpload: React.FC = () => {
  const { message } = App.useApp();
  const [currentStep, setCurrentStep] = useState(0);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [previewModalVisible, setPreviewModalVisible] = useState(false);

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
      
      message.success('템플릿이 다운로드되었습니다.');
    } catch (error) {
      console.error('Template download error:', error);
      message.error('템플릿 다운로드 중 오류가 발생했습니다.');
    }
  };

  // 파일 업로드 처리
  const handleUpload = async () => {
    if (fileList.length === 0) {
      message.error('업로드할 파일을 선택해주세요.');
      return;
    }

    const formData = new FormData();
    formData.append('file', fileList[0].originFileObj as File);

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

      if (result.success) {
        message.success(result.message);
        setCurrentStep(2); // 완료 단계로 이동
      } else {
        if (result.validation_errors) {
          setValidationErrors(result.validation_errors);
          setCurrentStep(1); // 검증 결과 단계로 이동
        }
        message.error(result.error || '업로드 중 오류가 발생했습니다.');
      }
    } catch (error) {
      console.error('Upload error:', error);
      message.error('파일 업로드 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  };

  // 파일 선택 처리
  const uploadProps: UploadProps = {
    accept: '.xlsx,.xls,.csv',
    maxCount: 1,
    fileList,
    onChange: ({ fileList: newFileList }) => {
      setFileList(newFileList);
      setUploadResult(null);
      setValidationErrors([]);
      setCurrentStep(0);
    },
    beforeUpload: (file) => {
      const isValidType = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv'
      ].includes(file.type);
      
      if (!isValidType) {
        message.error('Excel 파일(.xlsx, .xls) 또는 CSV 파일만 업로드 가능합니다.');
        return false;
      }

      const isValidSize = file.size / 1024 / 1024 < 10; // 10MB
      if (!isValidSize) {
        message.error('파일 크기는 10MB를 초과할 수 없습니다.');
        return false;
      }

      return false; // 자동 업로드 방지
    },
    onRemove: () => {
      setFileList([]);
      setUploadResult(null);
      setValidationErrors([]);
      setCurrentStep(0);
    }
  };

  // 검증 오류 테이블 컬럼
  const errorColumns = [
    {
      title: '행 번호',
      dataIndex: 'row',
      key: 'row',
      width: 80,
      sorter: (a: ValidationError, b: ValidationError) => a.row - b.row,
    },
    {
      title: '필드',
      dataIndex: 'field',
      key: 'field',
      width: 120,
    },
    {
      title: '오류 내용',
      dataIndex: 'message',
      key: 'message',
      width: 300,
    },
    {
      title: '입력된 값',
      dataIndex: 'value',
      key: 'value',
      width: 150,
      render: (value: any) => (
        <Text code style={{ fontSize: '12px' }}>
          {value === null || value === undefined ? '(비어있음)' : String(value)}
        </Text>
      ),
    },
  ];

  // 재시작
  const handleRestart = () => {
    setFileList([]);
    setUploadResult(null);
    setValidationErrors([]);
    setCurrentStep(0);
  };

  const steps = [
    {
      title: '파일 선택',
      description: 'Excel 파일을 업로드합니다',
      icon: <UploadOutlined />,
    },
    {
      title: '검증 결과',
      description: '데이터 검증 결과를 확인합니다',
      icon: <EyeOutlined />,
    },
    {
      title: '완료',
      description: '설비 등록이 완료되었습니다',
      icon: <CheckCircleOutlined />,
    },
  ];

  return (
    <Card>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <Title level={3}>
            <FileExcelOutlined style={{ marginRight: 8 }} />
            설비 일괄 등록
          </Title>
          <Paragraph type="secondary">
            Excel 파일을 사용하여 여러 설비를 한 번에 등록할 수 있습니다.
          </Paragraph>
        </div>

        <Steps current={currentStep} items={steps} style={{ marginBottom: 32 }} />

        {/* 단계 0: 파일 선택 */}
        {currentStep === 0 && (
          <div>
            <Row gutter={24}>
              <Col xs={24} md={12}>
                <Card title="1. 템플릿 다운로드" size="small" style={{ marginBottom: 16 }}>
                  <Paragraph>
                    먼저 Excel 템플릿을 다운로드하여 설비 정보를 입력하세요.
                  </Paragraph>
                  <Button 
                    type="primary" 
                    icon={<DownloadOutlined />}
                    onClick={handleDownloadTemplate}
                  >
                    템플릿 다운로드
                  </Button>
                </Card>
              </Col>
              
              <Col xs={24} md={12}>
                <Card title="2. 파일 업로드" size="small" style={{ marginBottom: 16 }}>
                  <Paragraph>
                    작성한 Excel 파일을 업로드하세요.
                  </Paragraph>
                  <Upload.Dragger {...uploadProps} style={{ marginBottom: 16 }}>
                    <p className="ant-upload-drag-icon">
                      <UploadOutlined />
                    </p>
                    <p className="ant-upload-text">
                      클릭하거나 파일을 드래그하여 업로드
                    </p>
                    <p className="ant-upload-hint">
                      .xlsx, .xls, .csv 파일만 지원 (최대 10MB)
                    </p>
                  </Upload.Dragger>
                </Card>
              </Col>
            </Row>

            {fileList.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Button 
                  type="primary" 
                  size="large"
                  loading={uploading}
                  onClick={handleUpload}
                  icon={<SaveOutlined />}
                >
                  업로드 시작
                </Button>
              </div>
            )}
          </div>
        )}

        {/* 단계 1: 검증 결과 */}
        {currentStep === 1 && uploadResult && !uploadResult.success && (
          <div>
            <Alert
              message="데이터 검증 오류"
              description={`총 ${uploadResult.total_rows}행 중 ${uploadResult.error_rows}행에서 오류가 발견되었습니다.`}
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
            />

            {uploadResult.duplicate_names && uploadResult.duplicate_names.length > 0 && (
              <Alert
                message="중복된 설비명"
                description={
                  <div>
                    <p>이미 등록된 설비가 있습니다:</p>
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
              <Card title="검증 오류 상세" style={{ marginBottom: 16 }}>
                <Table
                  columns={errorColumns}
                  dataSource={validationErrors}
                  rowKey={(record) => `${record.row}-${record.field}`}
                  size="small"
                  pagination={{
                    pageSize: 10,
                    showSizeChanger: true,
                    showTotal: (total) => `총 ${total}개 오류`,
                  }}
                  scroll={{ x: 700 }}
                />
              </Card>
            )}

            <Space>
              <Button onClick={handleRestart} icon={<ReloadOutlined />}>
                다시 시작
              </Button>
            </Space>
          </div>
        )}

        {/* 단계 2: 완료 */}
        {currentStep === 2 && uploadResult && uploadResult.success && (
          <div>
            <Alert
              message="업로드 완료"
              description={
                <div>
                  <p>{uploadResult.message}</p>
                  <p>등록된 설비 수: <strong>{uploadResult.inserted_count}개</strong></p>
                </div>
              }
              type="success"
              showIcon
              style={{ marginBottom: 16 }}
            />

            <Space>
              <Button type="primary" onClick={handleRestart} icon={<ReloadOutlined />}>
                새로 등록하기
              </Button>
            </Space>
          </div>
        )}

        {/* 업로드 중 상태 */}
        {uploading && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>
              <Text>파일을 업로드하고 있습니다...</Text>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

export default MachinesBulkUpload;