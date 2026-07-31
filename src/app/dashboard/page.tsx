'use client';

import React from 'react';
import { DashboardRouter } from '@/components/dashboard/DashboardRouter';
import { useAuth } from '@/contexts/AuthContext';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <DashboardRouter user={user} />
  );
}