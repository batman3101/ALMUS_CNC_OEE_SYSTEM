'use client';

import React, { useState, useMemo, useCallback, memo } from 'react';
import { Modal, Form, InputNumber, Button, message, Space, Typography, Divider, theme } from 'antd';
import { Machine } from '@/types';
import { z } from 'zod';
import { useMachinesTranslation } from '@/hooks/useTranslation';

const { Title, Text } = Typography;

// 타입 정의
interface TranslationFunction {
  (key: string): string;
}

// 상수 정의
const MODAL_CONFIG = {
  WIDTH: 500,
  MARGIN_BOTTOM: 16,
  MARGIN_TOP: 16,
  MARGIN_LEFT: 8,
  PADDING: 12,
  BORDER_RADIUS: 6,
  FONT_SIZE: 12,
} as const;

// 생산 실적 입력 데이터 검증 스키마 - 동적으로 생성됨
const createProductionInputSchema = (t: TranslationFunction) => z.object({
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
  cavityCount?: number; // 현재 공정의 Cavity 수량
}

interface ProductionInputData {
  output_qty: number;
  defect_qty: number;
}

const ProductionRecordInput: React.FC<ProductionRecordInputProps> = memo(({
  visible,
  onClose,
  machine,
  shift,
  date,
  onSubmit,
  estimatedOutput,
  cavityCount
}) => {
  const { t } = useMachinesTranslation();
  const { token } = theme.useToken();
  const [form] = Form.useForm<ProductionInputData>();
  const [loading, setLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // 스키마 메모이제이션
  const productionInputSchema = useMemo(() => 
    createProductionInputSchema(t), [t]
  );

  // 스타일 객체들 메모이제이션
  const machineInfoStyle = useMemo(() => ({ 
    marginBottom: MODAL_CONFIG.MARGIN_BOTTOM 
  }), []);

  const estimatedOutputStyle = useMemo(() => ({ 
    marginBottom: MODAL_CONFIG.MARGIN_BOTTOM 
  }), []);

  const estimatedButtonStyle = useMemo(() => ({ 
    marginLeft: MODAL_CONFIG.MARGIN_LEFT 
  }), []);

  const notesStyle = useMemo(() => ({
    marginTop: MODAL_CONFIG.MARGIN_TOP,
    padding: MODAL_CONFIG.PADDING,
    backgroundColor: token.colorBgLayout,
    borderRadius: MODAL_CONFIG.BORDER_RADIUS,
    border: `1px solid ${token.colorBorderSecondary}`
  }), [token.colorBgLayout, token.colorBorderSecondary]);

  const notesTextStyle = useMemo(() => ({ 
    fontSize: MODAL_CONFIG.FONT_SIZE 
  }), []);

  const inputStyle = useMemo(() => ({ width: '100%' }), []);

  // formatter/parser 함수들 메모이제이션
  const numberFormatter = useCallback((value: number | undefined) =>
    `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ','), []);

  const numberParser = useCallback((value: string | undefined) =>
    value!.replace(/\$\s?|(,*)/g, ''), []);

  const handleSubmit = useCallback(async () => {
    try {
      setLoading(true);
      setValidationErrors({});

      // 폼 데이터 가져오기
      const values = await form.validateFields();
      
      // Zod 스키마로 데이터 검증
      const validatedData = productionInputSchema.parse(values);

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
        if (process.env.NODE_ENV === 'development') {
          console.error('생산 실적 입력 오류:', error);
        }
        message.error(t('productionInput.errorMessage'));
      }
    } finally {
      setLoading(false);
    }
  }, [productionInputSchema, onSubmit, t, form, onClose]);

  const handleCancel = useCallback(() => {
    form.resetFields();
    setValidationErrors({});
    onClose();
  }, [form, onClose]);

  // 추정 생산량 사용
  const useEstimatedOutput = useCallback(() => {
    if (estimatedOutput) {
      form.setFieldsValue({ output_qty: estimatedOutput });
    }
  }, [estimatedOutput, form]);

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
      width={MODAL_CONFIG.WIDTH}
      destroyOnHidden
    >
      <div style={machineInfoStyle}>
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
            style={inputStyle}
            placeholder={t('productionInput.outputQtyPlaceholder')}
            min={0}
            precision={0}
            formatter={numberFormatter}
            parser={numberParser}
          />
        </Form.Item>

        {estimatedOutput && (
          <div style={estimatedOutputStyle}>
            <Text type="secondary">
              {t('productionInput.estimatedOutput')}: {estimatedOutput.toLocaleString()}{t('productionInput.piece')}
              {cavityCount && cavityCount > 1 && (
                <span style={{ marginLeft: 8, color: token.colorTextSecondary }}>
                  (Cavity {cavityCount}{t('단위.개')} × {Math.floor(estimatedOutput / cavityCount).toLocaleString()} {t('productionInput.cycles')})
                </span>
              )}
            </Text>
            <Button
              type="link"
              size="small"
              onClick={useEstimatedOutput}
              style={estimatedButtonStyle}
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
            style={inputStyle}
            placeholder={t('productionInput.defectQtyPlaceholder')}
            min={0}
            precision={0}
            formatter={numberFormatter}
            parser={numberParser}
          />
        </Form.Item>

        <div style={notesStyle}>
          <Text type="secondary" style={notesTextStyle}>
            <strong>{t('productionInput.notes')}:</strong><br />
            • {t('productionInput.note1')}<br />
            • {t('productionInput.note2')}<br />
            • {t('productionInput.note3')}
          </Text>
        </div>
      </Form>
    </Modal>
  );
}); // React.memo 종료

ProductionRecordInput.displayName = 'ProductionRecordInput';

export default ProductionRecordInput;