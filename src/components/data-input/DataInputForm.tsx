'use client';

import React from 'react';
import { Typography, Card } from 'antd';
import { useLanguage } from '@/contexts/LanguageContext';
import ShiftDataInputForm from './ShiftDataInputForm';

const { Title } = Typography;

const DataInputForm: React.FC = () => {
  const { t } = useLanguage();

  return (
    <div>
      <ShiftDataInputForm />
    </div>
  );
};

export default DataInputForm;