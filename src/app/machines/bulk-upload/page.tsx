'use client';

import React from 'react';
import MachinesBulkUpload from '@/components/machines/MachinesBulkUpload';
import { ProtectedRoute } from '@/components/auth';

// 제목/설명은 MachinesBulkUpload 가 자체 헤더로 렌더링한다. 여기서 다시 그리면 화면에 두 번 나온다.
export default function BulkUploadPage() {
  return (
    <ProtectedRoute>
      <div className="container mx-auto p-6">
        <MachinesBulkUpload />
      </div>
    </ProtectedRoute>
  );
}