'use client';

import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import MachinesBulkUpload from '@/components/machines/MachinesBulkUpload';
import { ProtectedRoute } from '@/components/auth';

export default function BulkUploadPage() {
  const { t } = useTranslation();

  return (
    <ProtectedRoute>
      <div className="container mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            {t('machines.bulkUpload')}
          </h1>
          <p className="text-gray-600 mt-2">
            {t('machines.bulkUploadDescription')}
          </p>
        </div>

        <MachinesBulkUpload />
      </div>
    </ProtectedRoute>
  );
}