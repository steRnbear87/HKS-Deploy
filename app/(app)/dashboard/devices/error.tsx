'use client';

import { Laptop } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function DevicesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <DashboardRouteError
      error={error}
      reset={reset}
      title={<T>Devices</T>}
      description={<T>Devices managed by Microsoft Intune</T>}
      icon={Laptop}
      logLabel="Devices"
    />
  );
}
