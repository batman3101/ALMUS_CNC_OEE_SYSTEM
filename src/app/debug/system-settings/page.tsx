'use client';

import React from 'react';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import SystemSettingsDebug from '@/components/debug/SystemSettingsDebug';

export default function SystemSettingsDebugPage() {
  return (
    <ProtectedRoute>
      <SystemSettingsDebug />
    </ProtectedRoute>
  );
}