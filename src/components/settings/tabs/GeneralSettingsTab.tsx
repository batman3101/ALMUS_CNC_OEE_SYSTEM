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
import type { UploadFile, UploadChangeParam } from 'antd/es/upload/interface';
import { authFetch } from '@/lib/authFetch';

const { Title, Text } = Typography;

interface GeneralSettingsTabProps {
  onSettingsChange?: () => void;
}

const GeneralSettingsTab: React.FC<GeneralSettingsTabProps> = ({ onSettingsChange }) => {
  const { t } = useLanguage();
  const { settings, updateMultipleSettings } = useGeneralSettings();
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
  const handleSave = async (values: Record<string, unknown>) => {
    try {
      setLoading(true);
      
      // 데이터 구조 검증
      if (!values || typeof values !== 'object') {
        throw new Error('Invalid form values');
      }

      // 여기서 저장하는 language 는 "전역 기본 언어"다 — 아직 개인 언어를 고르지 않은
      // 사용자에게 적용되는 초기값이며, 이미 사용 중인 사용자(관리자 본인 포함)의 화면 언어를
      // 바꾸지 않는다. 개인 언어는 헤더의 언어 토글(UserPreferences)로만 바뀐다.
      // (예전에는 이 저장이 곧 모든 사용자의 언어 변경이었다)

      // updateMultipleSettings 가 기대하는 { key, value, reason } 형태로 변환
      // (DB 의 canonical key 는 default_language 이므로 폼 필드명 language 를 매핑해준다)
      const updates = Object.entries(values)
        .filter(([, value]) => value !== undefined && value !== null) // null/undefined 값 제외
        .map(([key, value]) => ({
          key: key === 'language' ? 'default_language' : key,
          value,
          reason: `일반 설정 업데이트: ${key}`
        }));

      if (updates.length === 0) {
        showError(t('settings.general.noChanges'));
        return;
      }

      console.log('Updating settings:', updates);

      // updateMultipleSettings 호출
      const success = await updateMultipleSettings(updates);
      if (!success) {
        // 이 메시지는 아래 catch 에서 error.message 로 토스트에 그대로 표시된다.
        throw new Error(t('settings.general.updateFailed'));
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
        showError(t('settings.general.logoImageOnly'));
        return false;
      }

      // 서버(/api/upload/image)의 MAX_FILE_SIZE 와 같은 5MB 여야 한다.
      const isLt5M = file.size / 1024 / 1024 < 5;
      if (!isLt5M) {
        showError(t('settings.general.logoSizeLimit'));
        return false;
      }

      // FormData 생성
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'logo');

      // API 호출
      const response = await authFetch('/api/upload/image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '' }));
        throw new Error(errorData.error || t('settings.general.uploadFailed'));
      }

      const result = await response.json();

      if (!result.url) {
        throw new Error(t('settings.general.uploadNoUrl'));
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

      showSuccess(t('settings.general.logoUploadSuccess'));
      return false; // 기본 업로드 동작 방지

    } catch (error) {
      console.error('로고 업로드 오류:', error);
      const errorMessage = error instanceof Error ? error.message : t('settings.general.logoUploadError');
      showError(errorMessage);
      return false;
    } finally {
      setUploadingLogo(false);
    }
  };

  // 업로드 상태 변경 처리
  const handleUploadChange = (info: UploadChangeParam<UploadFile>) => {
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
    { label: t('settings.general.timezones.seoul'), value: 'Asia/Seoul' },
    { label: t('settings.general.timezones.hoChiMinh'), value: 'Asia/Ho_Chi_Minh' },
    { label: t('settings.general.timezones.utc'), value: 'UTC' },
    { label: t('settings.general.timezones.tokyo'), value: 'Asia/Tokyo' },
    { label: t('settings.general.timezones.shanghai'), value: 'Asia/Shanghai' },
  ];

  // 언어 옵션.
  // 실제 번역 리소스가 있는 언어만 노출한다 (src/lib/i18n.ts 의 resources 와 일치해야 한다).
  // 예전에는 'English' 가 있었지만 en 리소스가 없어서, 선택하면 설정만 en 으로 저장되고
  // 화면은 ko 로 폴백되는 상태가 됐다.
  const languageOptions = [
    { label: '한국어', value: 'ko' },
    { label: 'Tiếng Việt', value: 'vi' },
  ];

  // 날짜 형식 옵션 (형식 문자열 자체가 언어 중립적이라 번역하지 않는다)
  const dateFormatOptions = [
    { label: 'YYYY-MM-DD (2024-12-14)', value: 'YYYY-MM-DD' },
    { label: 'DD/MM/YYYY (14/12/2024)', value: 'DD/MM/YYYY' },
    { label: 'MM/DD/YYYY (12/14/2024)', value: 'MM/DD/YYYY' },
    { label: 'DD-MM-YYYY (14-12-2024)', value: 'DD-MM-YYYY' },
  ];

  // 시간 형식 옵션
  const timeFormatOptions = [
    { label: t('settings.general.timeFormats.h24s'), value: 'HH:mm:ss' },
    { label: t('settings.general.timeFormats.h12s'), value: 'hh:mm:ss A' },
    { label: t('settings.general.timeFormats.h24m'), value: 'HH:mm' },
    { label: t('settings.general.timeFormats.h12m'), value: 'hh:mm A' },
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
                        {uploadingLogo ? t('settings.general.uploading') : t('settings.general.uploadLogo')}
                      </Button>
                    )}
                  </Upload>
                  <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '8px' }}>
                    {t('settings.general.logoFileHint')}
                  </Text>
                  {uploadingLogo && (
                    <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '4px', color: '#1890ff' }}>
                      {t('settings.general.uploadingHint')}
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
