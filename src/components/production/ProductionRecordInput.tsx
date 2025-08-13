'use client';

import React, { useState } from 'react';
import { Modal, Form, InputNumber, Button, message, Space, Typography, Divider } from 'antd';
import { ProductionRecord, Machine } from '@/types';
import { z } from 'zod';

const { Title, Text } = Typography;

// 생산 실적 입력 데이터 검증 스키마
const productionInputSchema = z.object({
  output_qty: z.number().min(0, '생산 수량은 0 이상이어야 합니다'),
  defect_qty: z.number().min(0, '불량 수량은 0 이상이어야 합니다'),
}).refine((data) => data.defect_qty <= data.output_qty, {
  message: '불량 수량은 생산 수량보다 클 수 없습니다',
  path: ['defect_qty'],
});

interface ProductionRecordInputProps {
  visible: boolean;
  onClose: () => void;
  machine: Machine;
  shift: 'A' | 'B';
  date: string;
  onSubmit: (data: { output_qty: number; defect_qty: number }) => Promise<void>;
  estimatedOutput?: number; // Tact Time 기반 추정 생산량
}

interface ProductionInputData {
  output_qty: number;
  defect_qty: number;
}

export const ProductionRecordInput: React.FC<ProductionRecordInputProps> = ({
  visible,
  onClose,
  machine,
  shift,
  date,
  onSubmit,
  estimatedOutput
}) => {
  const [form] = Form.useForm<ProductionInputData>();
  const [loading, setLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const handleSubmit = async () => {
    try {
      setLoading(true);
      setValidationErrors({});

      // 폼 데이터 가져오기
      const values = await form.validateFields();
      
      // Zod 스키마로 데이터 검증
      const validatedData = productionInputSchema.parse(values);

      // 부모 컴포넌트로 데이터 전달
      await onSubmit(validatedData);
      
      message.success('생산 실적이 성공적으로 입력되었습니다');
      form.resetFields();
      onClose();
    } catch (error) {
      if (error instanceof z.ZodError) {
        // 검증 오류 처리
        const errors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path.length > 0) {
            errors[err.path[0] as string] = err.message;
          }
        });
        setValidationErrors(errors);
        message.error('입력 데이터를 확인해주세요');
      } else {
        console.error('생산 실적 입력 오류:', error);
        message.error('생산 실적 입력 중 오류가 발생했습니다');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setValidationErrors({});
    onClose();
  };

  // 추정 생산량 사용
  const useEstimatedOutput = () => {
    if (estimatedOutput) {
      form.setFieldsValue({ output_qty: estimatedOutput });
    }
  };

  return (
    <Modal
      title="생산 실적 입력"
      open={visible}
      onCancel={handleCancel}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          취소
        </Button>,
        <Button key="submit" type="primary" loading={loading} onClick={handleSubmit}>
          입력 완료
        </Button>,
      ]}
      width={500}
      destroyOnHidden
    >
      <div style={{ marginBottom: 16 }}>
        <Title level={5}>설비 정보</Title>
        <Space direction="vertical" size="small">
          <Text><strong>설비명:</strong> {machine.name}</Text>
          <Text><strong>위치:</strong> {machine.location}</Text>
          <Text><strong>날짜:</strong> {date}</Text>
          <Text><strong>교대:</strong> {shift}조</Text>
        </Space>
      </div>

      <Divider />

      <Form
        form={form}
        layout="vertical"
        initialValues={{ output_qty: 0, defect_qty: 0 }}
      >
        <Form.Item
          label="총 생산 수량"
          name="output_qty"
          rules={[
            { required: true, message: '생산 수량을 입력해주세요' },
            { type: 'number', min: 0, message: '생산 수량은 0 이상이어야 합니다' }
          ]}
          validateStatus={validationErrors.output_qty ? 'error' : ''}
          help={validationErrors.output_qty}
        >
          <InputNumber
            style={{ width: '100%' }}
            placeholder="생산된 총 수량을 입력하세요"
            min={0}
            precision={0}
            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(value) => value!.replace(/\$\s?|(,*)/g, '')}
          />
        </Form.Item>

        {estimatedOutput && (
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">
              Tact Time 기반 추정 생산량: {estimatedOutput.toLocaleString()}개
            </Text>
            <Button 
              type="link" 
              size="small" 
              onClick={useEstimatedOutput}
              style={{ marginLeft: 8 }}
            >
              사용하기
            </Button>
          </div>
        )}

        <Form.Item
          label="불량 수량"
          name="defect_qty"
          rules={[
            { required: true, message: '불량 수량을 입력해주세요' },
            { type: 'number', min: 0, message: '불량 수량은 0 이상이어야 합니다' }
          ]}
          validateStatus={validationErrors.defect_qty ? 'error' : ''}
          help={validationErrors.defect_qty}
        >
          <InputNumber
            style={{ width: '100%' }}
            placeholder="불량품 수량을 입력하세요"
            min={0}
            precision={0}
            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(value) => value!.replace(/\$\s?|(,*)/g, '')}
          />
        </Form.Item>

        <div style={{ marginTop: 16, padding: 12, backgroundColor: '#f5f5f5', borderRadius: 6 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <strong>참고사항:</strong><br />
            • 생산 수량은 해당 교대에서 실제로 생산된 총 수량을 입력하세요<br />
            • 불량 수량은 생산된 제품 중 불량으로 판정된 수량을 입력하세요<br />
            • 불량 수량은 생산 수량보다 클 수 없습니다
          </Text>
        </div>
      </Form>
    </Modal>
  );
};

export default ProductionRecordInput;