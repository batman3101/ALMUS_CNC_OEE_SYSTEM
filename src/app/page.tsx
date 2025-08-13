'use client';

import React from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { DashboardRouter } from '@/components/dashboard/DashboardRouter';
import { ProtectedRoute } from '@/components/auth';
import { useAuth } from '@/contexts/AuthContext';

export default function Home() {
  const { user } = useAuth();

  return (
    <ProtectedRoute>
      <AppLayout>
        <DashboardRouter user={user} />
      </AppLayout>
    </ProtectedRoute>
  );
}
