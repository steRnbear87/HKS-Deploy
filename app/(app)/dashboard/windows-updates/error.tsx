'use client';

import { MonitorCog } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function WindowsUpdatesError({
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
      title={<T>Windows Updates</T>}
      description={<T>Manage update rings, feature and quality updates, and driver policies</T>}
      icon={MonitorCog}
      logLabel="Windows Updates"
    />
  );
}
