'use client';

import { RefreshCw, Loader2, AlertTriangle, Info, ShieldQuestion, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDeviceWindowsUpdates } from '@/hooks/use-device-windows-updates';

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

function complianceTone(status: string | null): 'success' | 'error' | 'neutral' {
  if (!status) return 'neutral';
  if (status.toLowerCase().includes('not') || status.toLowerCase().includes('missing')) return 'error';
  if (status.toLowerCase() === 'compliant' || status.toLowerCase() === 'latest') return 'success';
  return 'neutral';
}

interface DeviceWindowsUpdatesSectionProps {
  deviceId: string;
  azureADDeviceId: string | null;
}

export function DeviceWindowsUpdatesSection({ deviceId, azureADDeviceId }: DeviceWindowsUpdatesSectionProps) {
  const { data, isLoading, error, refetch } = useDeviceWindowsUpdates(deviceId, azureADDeviceId);

  return (
    <div className="glass-light rounded-xl border border-overlay/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-primary">Windows Updates</h2>
        {data?.configured && (
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-text-secondary hover:text-text-primary">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        )}
      </div>

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

      {!isLoading && !error && data && !data.configured && (
        <div className="flex flex-col items-center py-8 text-center max-w-lg mx-auto">
          <ShieldQuestion className="w-8 h-8 text-text-muted mb-3" />
          <p className="text-sm text-text-primary font-medium mb-1">Not set up</p>
          <p className="text-sm text-text-muted mb-3">{data.reason}</p>
          <a
            href="https://learn.microsoft.com/en-us/windows/deployment/update/wufb-reports-overview"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent-cyan hover:text-accent-cyan-bright underline"
          >
            Learn how to set up Windows Update for Business reports
          </a>
        </div>
      )}

      {!isLoading && !error && data?.configured && (
        <div className="space-y-4">
          {data.pendingReboot && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-status-warning/10 border border-status-warning/20">
              <RotateCw className="w-4 h-4 text-status-warning flex-shrink-0 mt-0.5" />
              <p className="text-xs text-text-secondary">
                <span className="font-medium text-text-primary">Reboot pending</span> — last reported{' '}
                {formatDate(data.rebootRequiredSince ?? null)} (as of the last WUfB scan; not necessarily
                current).
              </p>
            </div>
          )}
          {data.summary ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-text-muted mb-1">OS Build</p>
                <p className="text-sm text-text-primary">{data.summary.osBuild || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted mb-1">Feature Update</p>
                <StatusBadge tone={complianceTone(data.summary.featureUpdateComplianceStatus)}>
                  {data.summary.featureUpdateComplianceStatus || 'Unknown'}
                </StatusBadge>
              </div>
              <div>
                <p className="text-xs text-text-muted mb-1">Quality Update</p>
                <StatusBadge tone={complianceTone(data.summary.qualityUpdateStatus)}>
                  {data.summary.qualityUpdateStatus || 'Unknown'}
                </StatusBadge>
              </div>
              <div>
                <p className="text-xs text-text-muted mb-1">Security Update</p>
                <StatusBadge tone={complianceTone(data.summary.securityUpdateStatus)}>
                  {data.summary.securityUpdateStatus || 'Unknown'}
                </StatusBadge>
              </div>
              <div>
                <p className="text-xs text-text-muted mb-1">Last Scan</p>
                <p className="text-sm text-text-primary">{formatDate(data.summary.lastWuScanTime)}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-status-warning/10 border border-status-warning/20">
              <Info className="w-4 h-4 text-status-warning flex-shrink-0 mt-0.5" />
              <p className="text-xs text-text-muted">
                No summary data yet for this device. It can take 48-72 hours after enrollment for a
                device to first appear in Windows Update for Business reports.
              </p>
            </div>
          )}

          {data.events && data.events.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-overlay/15">
                    <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Update</th>
                    <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">KB</th>
                    <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Status</th>
                    <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Installed</th>
                    <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Restart Required</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((event, idx) => (
                    <tr key={idx} className="border-b border-overlay/10 hover:bg-bg-elevated/30 transition-colors">
                      <td className="py-2 px-3 text-sm text-text-primary">{event.updateDisplayName || '—'}</td>
                      <td className="py-2 px-3 text-sm text-text-muted">{event.kbNumber || '—'}</td>
                      <td className="py-2 px-3 text-sm text-text-secondary">
                        {event.furthestClientSubstate || event.clientSubstate || '—'}
                      </td>
                      <td className="py-2 px-3 text-sm text-text-muted whitespace-nowrap">
                        {formatDate(event.updateInstalledTime)}
                      </td>
                      <td className="py-2 px-3 text-sm text-text-muted whitespace-nowrap">
                        {event.restartRequiredTime ? formatDate(event.restartRequiredTime) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-text-muted">No update events reported for this device yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
