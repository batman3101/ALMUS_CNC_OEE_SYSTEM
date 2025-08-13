'use client';

import React from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import SystemSettingsDemo from '@/components/demo/SystemSettingsDemo';

export default function SettingsDemoPage() {
  return (
    <ProtectedRoute>
      <SystemSettingsDemo />
    </ProtectedRoute>
  );
}