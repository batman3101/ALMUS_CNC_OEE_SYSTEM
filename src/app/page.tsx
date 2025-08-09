'use client';

import React, { useState } from 'react';
import { Select, Space } from 'antd';
import AppLayout from '@/components/layout/AppLayout';
import { DashboardRouter } from '@/components/dashboard/DashboardRouter';
import { User } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';

export default function Home() {
  const isClient = useClientOnly();
  const [selectedRole, setSelectedRole] = useState<'admin' | 'operator' | 'engineer'>('admin');

  // 임시 사용자 객체 (실제 구현에서는 AuthContext에서 가져옴)
  const currentUser: User | null = isClient ? {
    id: 'temp-user',
    email: 'test@example.com',
    name: '테스트 사용자',
    role: selectedRole,
    assigned_machines: ['CNC-001', 'CNC-002', 'CNC-003'],
    created_at: '2024-01-01T00:00:00Z'
  } : null;

  return (
    <AppLayout>
      <DashboardRouter user={currentUser} selectedRole={selectedRole} onRoleChange={setSelectedRole} />
    </AppLayout>
  );
}
