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
      
      message.success('템플릿이 다운로드되었습니다.');
    } catch (error) {
      console.error('Template download error:', error);
      message.error('템플릿 다운로드 중 오류가 발생했습니다.');
    }
  };

  // 미리보기 처리
  const handlePreview = async () => {
    if (fileList.length === 0) {
      message.error('업로드할 파일을 선택해주세요.');
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
        message.success('데이터 미리보기가 완료되었습니다.');
      } else {
        if (result.validation_errors) {
          setValidationErrors(result.validation_errors);
          setCurrentStep(1); // 검증 결과 단계로 이동
        }
        message.error(result.error || '미리보기 중 오류가 발생했습니다.');
      }
    } catch (error) {
      console.error('Preview error:', error);
      message.error('파일 미리보기 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  };

  // 파일 업로드 처리 (실제 등록)
  const handleUpload = async () => {
    if (fileList.length === 0) {
      message.error('업로드할 파일을 선택해주세요.');
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
        message.error(result.error || '업로드 중 오류가 발생했습니다.');
      }
    } catch (error) {
      console.error('Upload error:', error);
      message.error('파일 업로드 중 오류가 발생했습니다.');
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
        message.error('Excel 파일(.xlsx, .xls)만 업로드 가능합니다.');
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
      setPreviewData([]);
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
      render: (value: unknown) => (
        <Text code style={{ fontSize: '12px' }}>
          {value === null || value === undefined ? '(비어있음)' : String(value)}
        </Text>
      ),
    },
  ];

  // 미리보기 데이터 테이블 컬럼
  const previewColumns = [
    {
      title: '설비명',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '위치',
      dataIndex: 'location',
      key: 'location',
      width: 150,
    },
    {
      title: '설비 타입',
      dataIndex: 'equipment_type',
      key: 'equipment_type',
      width: 120,
    },
    {
      title: '생산 모델',
      dataIndex: 'production_model_name',
      key: 'production_model_name',
      width: 120,
    },
    {
      title: '가공 공정',
      dataIndex: 'process_name',
      key: 'process_name',
      width: 100,
    },
    {
      title: '활성상태',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (value: boolean) => (
        <Tag color={value ? 'green' : 'red'}>
          {value ? '활성' : '비활성'}
        </Tag>
      ),
    },
    {
      title: '현재상태',
      dataIndex: 'current_state',
      key: 'current_state',
      width: 120,
      render: (value: string) => {
        const stateMap: Record<string, { color: string; text: string }> = {
          'NORMAL_OPERATION': { color: 'green', text: '정상가동' },
          'INSPECTION': { color: 'orange', text: '점검중' },
          'BREAKDOWN_REPAIR': { color: 'red', text: '고장수리중' },
          'PM_MAINTENANCE': { color: 'orange', text: 'PM중' },
          'MODEL_CHANGE': { color: 'blue', text: '모델교체' },
          'PLANNED_STOP': { color: 'purple', text: '계획정지' },
          'PROGRAM_CHANGE': { color: 'cyan', text: '프로그램교체' },
          'TOOL_CHANGE': { color: 'magenta', text: '공구교환' },
          'TEMPORARY_STOP': { color: 'red', text: '일시정지' },
        };
        const state = stateMap[value] || { color: 'default', text: value };
        return <Tag color={state.color}>{state.text}</Tag>;
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
      title: '파일 선택',
      description: 'Excel 파일을 업로드합니다',
      icon: <UploadOutlined />,
    },
    {
      title: '데이터 미리보기',
      description: '데이터 검증 및 미리보기를 확인합니다',
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
                      .xlsx, .xls 파일만 지원 (최대 10MB)
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
                    미리보기
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
                  message="데이터 미리보기"
                  description={`총 ${uploadResult.total_rows}행의 데이터가 성공적으로 검증되었습니다.`}
                  type="success"
                  showIcon
                  style={{ marginBottom: 16 }}
                />

                {uploadResult.warnings && uploadResult.warnings.length > 0 && (
                  <Alert
                    message="경고 사항"
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

                <Card title="등록될 설비 목록" style={{ marginBottom: 16 }}>
                  <Table
                    columns={previewColumns}
                    dataSource={previewData}
                    rowKey="name"
                    size="small"
                    pagination={{
                      pageSize: 10,
                      showSizeChanger: true,
                      showTotal: (total) => `총 ${total}개 설비`,
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
                    등록 확정
                  </Button>
                  <Button onClick={handleRestart} icon={<ReloadOutlined />}>
                    다시 시작
                  </Button>
                </Space>
              </div>
            )}

            {/* 검증 오류 */}
            {!uploadResult.success && (
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

        {/* 로딩 상태 */}
        {(uploading || confirming) && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>
              <Text>
                {uploading && '파일을 분석하고 있습니다...'}
                {confirming && '설비를 등록하고 있습니다...'}
              </Text>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

export default MachinesBulkUpload;