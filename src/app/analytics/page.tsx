'use client';

import React from 'react';
import { RoleGuard } from '@/components/auth';
import { EngineerDashboard } from '@/components/dashboard';

const AnalyticsPage: React.FC = () => {
  return (
    <RoleGuard allowedRoles={['admin', 'engineer']}>
      <div>
        <EngineerDashboard />
      </div>
    </RoleGuard>
  );
};

export default AnalyticsPage;
