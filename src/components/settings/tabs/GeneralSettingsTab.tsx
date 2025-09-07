'use client';

import React, { useState, useEffect } from 'react';
import { 
  Form, 
  Input, 
  Select, 
  Button, 
  Space, 
  Upload, 
  Card,
  Typography,
  Row,
  Col
} from 'antd';
import { UploadOutlined, SaveOutlined } from '@ant-design/icons';
import { useLanguage } from '@/contexts/LanguageContext';
import { useGeneralSettings } from '@/hooks/useSystemSettings';
import { useMessage } from '@/hooks/useMessage';
import type { UploadFile } from 'antd/es/upload/interface';

const { Title, Text } = Typography;
const { Option } = Select;

interface GeneralSettingsTabProps {
  onSettingsChange?: () => void;
}

const GeneralSettingsTab: React.FC<GeneralSettingsTabProps> = ({ onSettingsChange }) => {
  const { t, changeLanguage } = useLanguage();
  const { settings, updateSetting, updateMultipleSettings } = useGeneralSettings();
  const { success: showSuccess, error: showError, contextHolder } = useMessage();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoFileList, setLogoFileList] = useState<UploadFile[]>([]);

  // 폼 초기값 설정
  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        company_name: settings.company_name || 'ALMUS TECH',
        company_logo_url: settings.company_logo_url || '',
        timezone: settings.timezone || 'Asia/Ho_Chi_Minh',
        language: settings.language || 'vi',
        date_format: settings.date_format || 'DD/MM/YYYY',
        time_format: settings.time_format || 'HH:mm:ss'
      });

      // 로고 파일 리스트 설정
      if (settings.company_logo_url) {
        setLogoFileList([{
          uid: '-1',
          name: 'company-logo',
          status: 'done',
          url: settings.company_logo_url,
        }]);
      }
    }
  }, [settings, form]);

  // 설정 저장
  const handleSave = async (values: any) => {
    try {
      setLoading(true);
      
      // 데이터 구조 검증
      if (!values || typeof values !== 'object') {
        throw new Error('Invalid form values');
      }

      // 언어 변경 사항 확인
      const currentLanguage = settings?.language || 'ko';
      const newLanguage = values.language;
      const languageChanged = currentLanguage !== newLanguage;

      // SettingUpdate 형태로 변환 (category 포함)
      const updates = Object.entries(values)
        .filter(([_, value]) => value !== undefined && value !== null) // null/undefined 값 제외
        .map(([key, value]) => ({
          category: 'general' as const,
          setting_key: key,
          setting_value: value,
          change_reason: `일반 설정 업데이트: ${key}`
        }));

      if (updates.length === 0) {
        showError('저장할 변경사항이 없습니다.');
        return;
      }

      console.log('Updating settings:', updates);
      
      // updateMultipleSettings 호출
      const success = await updateMultipleSettings(updates);
      if (!success) {
        throw new Error('시스템 설정 업데이트에 실패했습니다. 네트워크 연결이나 권한을 확인해주세요.');
      }

      // 언어가 변경된 경우 LanguageContext 업데이트
      if (languageChanged && newLanguage) {
        console.log('언어 변경 감지, LanguageContext 업데이트:', newLanguage);
        await changeLanguage(newLanguage as 'ko' | 'vi');
      }

      showSuccess(t('settings.saveSuccess'));
      onSettingsChange?.();
    } catch (error) {
      console.error('일반 설정 저장 오류:', error);
      const errorMessage = error instanceof Error ? error.message : t('settings.saveError');
      showError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // 로고 업로드 처리
  const handleLogoUpload = async (file: File) => {
    try {
      setUploadingLogo(true);
      
      // 파일 검증
      const isImage = file.type?.startsWith('image/');
      if (!isImage) {
        showError('이미지 파일만 업로드 가능합니다.');
        return false;
      }
      
      const isLt5M = file.size / 1024 / 1024 < 5;
      if (!isLt5M) {
        showError('파일 크기는 5MB 이하만 가능합니다.');
        return false;
      }

      // FormData 생성
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'logo');

      // API 호출
      const response = await fetch('/api/upload/image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '업로드 실패' }));
        throw new Error(errorData.error || '업로드에 실패했습니다.');
      }

      const result = await response.json();
      
      if (!result.url) {
        throw new Error('업로드된 파일 URL을 받을 수 없습니다.');
      }

      // 성공 시 폼 필드 업데이트
      form.setFieldValue('company_logo_url', result.url);
      
      // 파일 리스트 업데이트
      setLogoFileList([{
        uid: '-1',
        name: file.name,
        status: 'done',
        url: result.url,
      }]);

      showSuccess('로고가 성공적으로 업로드되었습니다.');
      return false; // 기본 업로드 동작 방지
      
    } catch (error) {
      console.error('로고 업로드 오류:', error);
      const errorMessage = error instanceof Error ? error.message : '업로드 중 오류가 발생했습니다.';
      showError(errorMessage);
      return false;
    } finally {
      setUploadingLogo(false);
    }
  };

  // 업로드 상태 변경 처리
  const handleUploadChange = (info: any) => {
    let fileList = [...info.fileList];
    fileList = fileList.slice(-1); // 파일 개수 제한 (1개만)
    setLogoFileList(fileList);
  };

  // 로고 제거
  const handleLogoRemove = () => {
    setLogoFileList([]);
    form.setFieldValue('company_logo_url', '');
    return true;
  };

  // 시간대 옵션
  const timezoneOptions = [
    { label: '서울 (Asia/Seoul)', value: 'Asia/Seoul' },
    { label: '호치민 (Asia/Ho_Chi_Minh)', value: 'Asia/Ho_Chi_Minh' },
    { label: 'UTC', value: 'UTC' },
    { label: '도쿄 (Asia/Tokyo)', value: 'Asia/Tokyo' },
    { label: '상하이 (Asia/Shanghai)', value: 'Asia/Shanghai' },
  ];

  // 언어 옵션
  const languageOptions = [
    { label: '한국어', value: 'ko' },
    { label: 'Tiếng Việt', value: 'vi' },
    { label: 'English', value: 'en' },
  ];

  // 날짜 형식 옵션
  const dateFormatOptions = [
    { label: 'YYYY-MM-DD (2024-12-14)', value: 'YYYY-MM-DD' },
    { label: 'DD/MM/YYYY (14/12/2024)', value: 'DD/MM/YYYY' },
    { label: 'MM/DD/YYYY (12/14/2024)', value: 'MM/DD/YYYY' },
    { label: 'DD-MM-YYYY (14-12-2024)', value: 'DD-MM-YYYY' },
  ];

  // 시간 형식 옵션
  const timeFormatOptions = [
    { label: '24시간 (HH:mm:ss)', value: 'HH:mm:ss' },
    { label: '12시간 (hh:mm:ss A)', value: 'hh:mm:ss A' },
    { label: '24시간 분만 (HH:mm)', value: 'HH:mm' },
    { label: '12시간 분만 (hh:mm A)', value: 'hh:mm A' },
  ];

  return (
    <div>
      {contextHolder}
      <Title level={4} style={{ marginBottom: '24px' }}>
        {t('settings.general.title')}
      </Title>
      
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        size="large"
      >
        <Row gutter={[24, 0]}>
          <Col xs={24} lg={12}>
            <Card title={t('settings.general.companyInfo')} size="small">
              <Form.Item
                name="company_name"
                label={t('settings.general.companyName')}
                rules={[
                  { required: true, message: t('settings.general.companyNameRequired') },
                  { min: 2, message: t('settings.general.companyNameMinLength') }
                ]}
              >
                <Input 
                  placeholder={t('settings.general.companyNamePlaceholder')}
                  maxLength={100}
                />
              </Form.Item>

              <Form.Item
                name="company_logo_url"
                label={t('settings.general.companyLogo')}
              >
                <div>
                  <Upload
                    name="logo"
                    listType="picture"
                    fileList={logoFileList}
                    onChange={handleUploadChange}
                    onRemove={handleLogoRemove}
                    beforeUpload={handleLogoUpload}
                    maxCount={1}
                    disabled={uploadingLogo}
                  >
                    {logoFileList.length === 0 && (
                      <Button 
                        icon={<UploadOutlined />}
                        loading={uploadingLogo}
                        disabled={uploadingLogo}
                      >
                        {uploadingLogo ? '업로드 중...' : '로고 업로드'}
                      </Button>
                    )}
                  </Upload>
                  <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '8px' }}>
                    이미지 파일만 가능 (JPG, PNG 등) - 최대 5MB
                  </Text>
                  {uploadingLogo && (
                    <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '4px', color: '#1890ff' }}>
                      업로드 중입니다. 잠시 기다려주세요...
                    </Text>
                  )}
                </div>
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card title={t('settings.general.localization')} size="small">
              <Form.Item
                name="timezone"
                label={t('settings.general.timezone')}
                rules={[{ required: true, message: t('settings.general.timezoneRequired') }]}
              >
                <Select
                  placeholder={t('settings.general.timezoneSelect')}
                  options={timezoneOptions}
                  showSearch
                  filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                />
              </Form.Item>

              <Form.Item
                name="language"
                label={t('settings.general.language')}
                rules={[{ required: true, message: t('settings.general.languageRequired') }]}
              >
                <Select
                  placeholder={t('settings.general.languageSelect')}
                  options={languageOptions}
                />
              </Form.Item>

              <Form.Item
                name="date_format"
                label={t('settings.general.dateFormat')}
              >
                <Select
                  placeholder={t('settings.general.dateFormatSelect')}
                  options={dateFormatOptions}
                />
              </Form.Item>

              <Form.Item
                name="time_format"
                label={t('settings.general.timeFormat')}
              >
                <Select
                  placeholder={t('settings.general.timeFormatSelect')}
                  options={timeFormatOptions}
                />
              </Form.Item>
            </Card>
          </Col>
        </Row>

        <div style={{ marginTop: '24px', textAlign: 'right' }}>
          <Space>
            <Button onClick={() => form.resetFields()}>
              {t('common.reset')}
            </Button>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              icon={<SaveOutlined />}
            >
              {t('common.save')}
            </Button>
          </Space>
        </div>
      </Form>
    </div>
  );
};

export default GeneralSettingsTab;