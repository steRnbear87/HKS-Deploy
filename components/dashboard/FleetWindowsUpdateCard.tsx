'use client';

import { Monitor, Loader2, AlertTriangle, ShieldQuestion, RotateCw } from 'lucide-react';
import { useFleetWindowsUpdates } from '@/hooks/use-fleet-windows-updates';

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function FleetWindowsUpdateCard() {
  const { data, isLoading, error } = useFleetWindowsUpdates();

  return (
    <div className="glass-light rounded-xl border border-overlay/5 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Monitor className="w-4 h-4 text-accent-cyan" />
        <h2 className="text-lg font-semibold text-text-primary">Windows Update Status</h2>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-accent-cyan animate-spin" />
        </div>
      )}

      {!isLoading && error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-status-error/10 border border-status-error/20">
          <AlertTriangle className="w-4 h-4 text-status-error flex-shrink-0 mt-0.5" />
          <p className="text-xs text-text-secondary">{error.message}</p>
        </div>
      )}

      {!isLoading && !error && data && !data.configured && (
        <div className="flex flex-col items-center py-6 text-center max-w-md mx-auto">
          <ShieldQuestion className="w-8 h-8 text-text-muted mb-3" />
          <p className="text-sm text-text-primary font-medium mb-1">Not set up</p>
          <p className="text-sm text-text-muted">{data.reason}</p>
        </div>
      )}

      {!isLoading && !error && data?.configured && (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-text-muted mb-1">Pending Restart</p>
            <div className="flex items-center gap-2">
              <RotateCw className="w-4 h-4 text-status-warning" />
              <p className="text-2xl font-bold text-text-primary">
                {data.pendingRestartCount?.toLocaleString() ?? '—'}
              </p>
            </div>
          </div>
          <div>
            <p className="text-xs text-text-muted mb-1">Devices Scanned</p>
            <p className="text-2xl font-bold text-text-primary">{data.devicesScanned?.toLocaleString() ?? '—'}</p>
          </div>
          <p className="text-xs text-text-muted">As of {formatDate(data.asOf)} (last 30 days)</p>
        </div>
      )}
    </div>
  );
}
