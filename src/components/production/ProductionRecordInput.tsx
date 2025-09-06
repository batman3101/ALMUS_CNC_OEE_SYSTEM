'use client';

import React, { useState } from 'react';
import { Modal, Form, InputNumber, Button, message, Space, Typography, Divider } from 'antd';
import { ProductionRecord, Machine } from '@/types';
import { z } from 'zod';
import { useMachinesTranslation } from '@/hooks/useTranslation';

const { Title, Text } = Typography;

// 생산 실적 입력 데이터 검증 스키마 - 동적으로 생성됨
const createProductionInputSchema = (t: any) => z.object({
  output_qty: z.number().min(0, t('productionInput.outputQtyMin')),
  defect_qty: z.number().min(0, t('productionInput.defectQtyMin')),
}).refine((data) => data.defect_qty <= data.output_qty, {
  message: t('productionInput.defectQtyMax'),
  path: ['defect_qty'],
});

interface ProductionRecordInputProps {
  visible: boolean;
  onClose: () => void;
  machine: Machine | null;
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
  const { t } = useMachinesTranslation();
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
      const validatedData = createProductionInputSchema(t).parse(values);

      // 부모 컴포넌트로 데이터 전달
      await onSubmit(validatedData);
      
      message.success(t('productionInput.successMessage'));
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
        message.error(t('productionInput.validationError'));
      } else {
        console.error('생산 실적 입력 오류:', error);
        message.error(t('productionInput.errorMessage'));
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
      title={t('productionInput.title')}
      open={visible}
      onCancel={handleCancel}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          {t('productionInput.cancel')}
        </Button>,
        <Button key="submit" type="primary" loading={loading} onClick={handleSubmit}>
          {t('productionInput.submit')}
        </Button>,
      ]}
      width={500}
      destroyOnHidden
    >
      <div style={{ marginBottom: 16 }}>
        <Title level={5}>{t('productionInput.machineInfo')}</Title>
        <Space direction="vertical" size="small">
          <Text><strong>{t('productionInput.machineName')}:</strong> {machine?.name || t('productionInput.noMachineInfo')}</Text>
          <Text><strong>{t('productionInput.location')}:</strong> {machine?.location || t('productionInput.noLocationInfo')}</Text>
          <Text><strong>{t('productionInput.date')}:</strong> {date}</Text>
          <Text><strong>{t('productionInput.shift')}:</strong> {shift}{t('productionInput.shiftSuffix')}</Text>
        </Space>
      </div>

      <Divider />

      <Form
        form={form}
        layout="vertical"
        initialValues={{ output_qty: 0, defect_qty: 0 }}
      >
        <Form.Item
          label={t('productionInput.outputQty')}
          name="output_qty"
          rules={[
            { required: true, message: t('productionInput.outputQtyRequired') },
            { type: 'number', min: 0, message: t('productionInput.outputQtyMin') }
          ]}
          validateStatus={validationErrors.output_qty ? 'error' : ''}
          help={validationErrors.output_qty}
        >
          <InputNumber
            style={{ width: '100%' }}
            placeholder={t('productionInput.outputQtyPlaceholder')}
            min={0}
            precision={0}
            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(value) => value!.replace(/\$\s?|(,*)/g, '')}
          />
        </Form.Item>

        {estimatedOutput && (
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">
              {t('productionInput.estimatedOutput')}: {estimatedOutput.toLocaleString()}{t('productionInput.piece')}
            </Text>
            <Button 
              type="link" 
              size="small" 
              onClick={useEstimatedOutput}
              style={{ marginLeft: 8 }}
            >
              {t('productionInput.useEstimated')}
            </Button>
          </div>
        )}

        <Form.Item
          label={t('productionInput.defectQty')}
          name="defect_qty"
          rules={[
            { required: true, message: t('productionInput.defectQtyRequired') },
            { type: 'number', min: 0, message: t('productionInput.defectQtyMin') }
          ]}
          validateStatus={validationErrors.defect_qty ? 'error' : ''}
          help={validationErrors.defect_qty}
        >
          <InputNumber
            style={{ width: '100%' }}
            placeholder={t('productionInput.defectQtyPlaceholder')}
            min={0}
            precision={0}
            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(value) => value!.replace(/\$\s?|(,*)/g, '')}
          />
        </Form.Item>

        <div style={{ marginTop: 16, padding: 12, backgroundColor: '#f5f5f5', borderRadius: 6 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <strong>{t('productionInput.notes')}:</strong><br />
            • {t('productionInput.note1')}<br />
            • {t('productionInput.note2')}<br />
            • {t('productionInput.note3')}
          </Text>
        </div>
      </Form>
    </Modal>
  );
};

export default ProductionRecordInput;