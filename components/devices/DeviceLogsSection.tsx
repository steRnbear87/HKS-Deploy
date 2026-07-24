'use client';

import { useState } from 'react';
import { FileText, Loader2, AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDeviceLogs, useRequestDeviceLogCollection, useDeviceLogDownloadUrl } from '@/hooks/use-device-logs';
import type { DeviceLogCollectionStatus } from '@/types/devices';

const statusTone: Record<DeviceLogCollectionStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  completed: 'success',
  pending: 'warning',
  failed: 'error',
  unknownFutureValue: 'neutral',
};

function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface DeviceLogsSectionProps {
  deviceId: string;
}

export function DeviceLogsSection({ deviceId }: DeviceLogsSectionProps) {
  const { data, isLoading, error, refetch } = useDeviceLogs(deviceId);
  const requestCollection = useRequestDeviceLogCollection(deviceId);
  const downloadUrl = useDeviceLogDownloadUrl(deviceId);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const requests = data?.requests ?? [];

  const handleDownload = async (requestId: string) => {
    setDownloadingId(requestId);
    try {
      const result = await downloadUrl.mutateAsync(requestId);
      window.open(result.url, '_blank');
    } catch {
      // Error surfaced via downloadUrl.error below
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="glass-light rounded-xl border border-overlay/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-accent-cyan" />
          <h2 className="text-lg font-semibold text-text-primary">Diagnostic Logs</h2>
        </div>
        <Button
          size="sm"
          onClick={() => requestCollection.mutate()}
          disabled={requestCollection.isPending}
        >
          {requestCollection.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <FileText className="w-4 h-4 mr-2" />
          )}
          Collect Diagnostics
        </Button>
      </div>

      {requestCollection.error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-status-error/10 border border-status-error/20 mb-4">
          <AlertTriangle className="w-4 h-4 text-status-error flex-shrink-0 mt-0.5" />
          <p className="text-xs text-text-secondary">{requestCollection.error.message}</p>
        </div>
      )}

      {downloadUrl.error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-status-error/10 border border-status-error/20 mb-4">
          <AlertTriangle className="w-4 h-4 text-status-error flex-shrink-0 mt-0.5" />
          <p className="text-xs text-text-secondary">{downloadUrl.error.message}</p>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-accent-cyan animate-spin" />
        </div>
      )}

      {!isLoading && error && (
        <div className="flex flex-col items-center py-8 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-400 mb-2" />
          <p className="text-sm text-text-secondary mb-3">{error.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-overlay/10">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !error && requests.length === 0 && (
        <p className="text-sm text-text-muted">
          No diagnostic log collections requested for this device yet.
        </p>
      )}

      {!isLoading && !error && requests.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="border-b border-overlay/15">
                <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Status</th>
                <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Requested</th>
                <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Size</th>
                <th className="text-right py-2 px-3 text-sm font-medium text-text-muted">Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id} className="border-b border-overlay/10 hover:bg-bg-elevated/30 transition-colors">
                  <td className="py-2 px-3">
                    <StatusBadge tone={statusTone[req.status]}>{req.status}</StatusBadge>
                  </td>
                  <td className="py-2 px-3 text-sm text-text-muted whitespace-nowrap">
                    {formatDate(req.requestedDateTimeUTC)}
                  </td>
                  <td className="py-2 px-3 text-sm text-text-muted">
                    {req.sizeInKB ? `${req.sizeInKB.toFixed(0)} KB` : '—'}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {req.status === 'completed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-overlay/10"
                        onClick={() => handleDownload(req.id)}
                        disabled={downloadingId === req.id}
                      >
                        {downloadingId === req.id ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4 mr-1" />
                        )}
                        Download
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
