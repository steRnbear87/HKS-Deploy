'use client';

import { Laptop } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function DeviceDetailError({
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
      title={<T>Device</T>}
      description={<T>Device details and management</T>}
      icon={Laptop}
      logLabel="Device Detail"
    />
  );
}
