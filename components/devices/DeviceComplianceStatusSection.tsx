'use client';

import { RefreshCw, Loader2, AlertTriangle, ShieldQuestion, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import { useDeviceComplianceStatus } from '@/hooks/use-device-compliance-status';
import type { DevicePolicyComplianceState } from '@/types/devices';

const stateTone: Record<DevicePolicyComplianceState, StatusTone> = {
  compliant: 'success',
  nonCompliant: 'error',
  error: 'error',
  conflict: 'error',
  remediated: 'warning',
  notApplicable: 'neutral',
  notAssigned: 'neutral',
  unknown: 'neutral',
};

function stateBadge(state: DevicePolicyComplianceState) {
  return <StatusBadge tone={stateTone[state] ?? 'neutral'}>{state}</StatusBadge>;
}

interface DeviceComplianceStatusSectionProps {
  deviceId: string;
}

export function DeviceComplianceStatusSection({ deviceId }: DeviceComplianceStatusSectionProps) {
  const { data, isLoading, error, refetch } = useDeviceComplianceStatus(deviceId);

  const policies = data?.compliancePolicyStates ?? [];
  const profiles = data?.configurationStates ?? [];
  const hasNothing = data?.configured && policies.length === 0 && profiles.length === 0;

  return (
    <div className="glass-light rounded-xl border border-overlay/5 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-accent-cyan" />
          <h2 className="text-lg font-semibold text-text-primary">Compliance &amp; Configuration Profiles</h2>
        </div>
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
          <p className="text-sm text-text-primary font-medium mb-1">Not available for this device</p>
          <p className="text-sm text-text-muted">{data.reason}</p>
        </div>
      )}

      {!isLoading && !error && hasNothing && (
        <p className="text-sm text-text-muted">
          No compliance policies or configuration profiles are currently assigned to this device.
        </p>
      )}

      {!isLoading && !error && data?.configured && !hasNothing && (
        <div className="space-y-6">
          {policies.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-text-secondary mb-2">Compliance Policies</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px]">
                  <thead>
                    <tr className="border-b border-overlay/15">
                      <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Policy Name</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Platform</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policies.map((policy) => (
                      <tr key={policy.id} className="border-b border-overlay/10 hover:bg-bg-elevated/30 transition-colors">
                        <td className="py-2 px-3 text-sm text-text-primary">{policy.displayName || '—'}</td>
                        <td className="py-2 px-3 text-sm text-text-muted">{policy.platformType || '—'}</td>
                        <td className="py-2 px-3">{stateBadge(policy.state)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {profiles.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-text-secondary mb-2">Configuration Profiles</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px]">
                  <thead>
                    <tr className="border-b border-overlay/15">
                      <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Profile Name</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">Platform</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-text-muted">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.map((profile) => (
                      <tr key={profile.id} className="border-b border-overlay/10 hover:bg-bg-elevated/30 transition-colors">
                        <td className="py-2 px-3 text-sm text-text-primary">{profile.displayName || '—'}</td>
                        <td className="py-2 px-3 text-sm text-text-muted">{profile.platformType || '—'}</td>
                        <td className="py-2 px-3">{stateBadge(profile.state)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
