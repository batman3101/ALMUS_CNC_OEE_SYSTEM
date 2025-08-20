'use client';

import React from 'react';
import { DashboardRouter } from '@/components/dashboard/DashboardRouter';
import { ProtectedRoute } from '@/components/auth';
import { useAuth } from '@/contexts/AuthContext';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <ProtectedRoute>
      <DashboardRouter user={user} />
    </ProtectedRoute>
  );
}