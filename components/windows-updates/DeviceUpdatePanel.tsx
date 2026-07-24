'use client';

import { useEffect, useState } from 'react';
import { MonitorCog, Loader2, Check } from 'lucide-react';
import { T } from 'gt-next';
import { toast } from 'sonner';
import { AnimatedEmptyState } from '@/components/dashboard';
import {
  useDeviceWindowsUpdateAssignments,
  useUpdateRings,
  useFeatureUpdateProfiles,
  useQualityUpdateProfiles,
  useDriverUpdateProfiles,
  useAssignDeviceUpdatePolicy,
} from '@/hooks/use-windows-updates';
import { DeviceUpdateStatusSection } from '@/components/windows-updates/DeviceUpdateStatusSection';
import type { ManagedDevice } from '@/types/devices';

const NONE_VALUE = '__none__';

interface DeviceUpdatePanelProps {
  device: ManagedDevice;
}

interface PolicySelectorProps {
  label: React.ReactNode;
  policyType: 'ring' | 'feature' | 'quality' | 'driver';
  device: ManagedDevice;
  currentId: string | null | undefined;
  isLoading: boolean;
  emptyMessage: React.ReactNode;
  options: Array<{ id: string; label: string }>;
}

function PolicySelector({ label, policyType, device, currentId, isLoading, emptyMessage, options }: PolicySelectorProps) {
  const assignMutation = useAssignDeviceUpdatePolicy();
  const [selectedId, setSelectedId] = useState<string>(currentId || NONE_VALUE);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSelectedId(currentId || NONE_VALUE);
    setSaved(false);
  }, [currentId, device.id]);

  const isDirty = selectedId !== (currentId || NONE_VALUE);

  const handleApply = async () => {
    if (!device.azureADDeviceId) return;
    try {
      await assignMutation.mutateAsync({
        deviceId: device.id,
        policyType,
        policyId: selectedId === NONE_VALUE ? null : selectedId,
        azureADDeviceId: device.azureADDeviceId,
        deviceName: device.deviceName,
      });
      setSaved(true);
      toast.success(`${label} assignment saved`);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      toast.error('Failed to save assignment', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-text-muted mb-2">{label}</label>
      {isLoading ? (
        <p className="text-sm text-text-muted"><T>Loading...</T></p>
      ) : options.length === 0 ? (
        <p className="text-sm text-text-muted">{emptyMessage}</p>
      ) : (
        <div className="flex items-center gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="flex-1 px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-cyan/40"
          >
            <option value={NONE_VALUE}>None assigned</option>
            {options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleApply}
            disabled={!isDirty || assignMutation.isPending}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent-cyan hover:bg-accent-cyan-dim text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {assignMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saved ? (
              <Check className="w-4 h-4" />
            ) : (
              <T>Apply</T>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Per-device Windows Update configuration - the literal "pick which updates
 * to deploy per device" ask. Ring/Feature/Quality are wired for real
 * (slices 2-3); Driver/M365 Apps land in later slices.
 */
export function DeviceUpdatePanel({ device }: DeviceUpdatePanelProps) {
  const { data: assignments, isLoading: isLoadingAssignments } = useDeviceWindowsUpdateAssignments(device.id);
  const { data: ringsData, isLoading: isLoadingRings } = useUpdateRings();
  const { data: featuresData, isLoading: isLoadingFeatures } = useFeatureUpdateProfiles();
  const { data: qualitiesData, isLoading: isLoadingQualities } = useQualityUpdateProfiles();
  const { data: driversData, isLoading: isLoadingDrivers } = useDriverUpdateProfiles();

  if (!device.azureADDeviceId) {
    return (
      <AnimatedEmptyState
        icon={MonitorCog}
        title={<T>Device not Entra ID-joined</T>}
        description={
          <T>
            This device has no Entra ID device record, so it can&apos;t be targeted with a
            dedicated update group.
          </T>
        }
        showOrbs={false}
        color="neutral"
      />
    );
  }

  return (
    <div className="space-y-6">
      <DeviceUpdateStatusSection device={device} />

      <PolicySelector
        label={<T>Update Ring</T>}
        policyType="ring"
        device={device}
        currentId={assignments?.ring?.id}
        isLoading={isLoadingAssignments || isLoadingRings}
        emptyMessage={<T>No Update Rings created yet - create one in the Update Rings tab first.</T>}
        options={(ringsData?.rings || []).map((ring) => ({
          id: ring.id,
          label: `${ring.displayName} (Q:${ring.qualityUpdatesDeferralPeriodInDays}d / F:${ring.featureUpdatesDeferralPeriodInDays}d)`,
        }))}
      />

      <PolicySelector
        label={<T>Feature Update</T>}
        policyType="feature"
        device={device}
        currentId={assignments?.feature?.id}
        isLoading={isLoadingAssignments || isLoadingFeatures}
        emptyMessage={<T>No Feature Update Profiles created yet - create one in the Feature Updates tab first.</T>}
        options={(featuresData?.profiles || []).map((profile) => ({
          id: profile.id,
          label: `${profile.displayName} (${profile.featureUpdateVersion})`,
        }))}
      />

      <PolicySelector
        label={<T>Quality Update</T>}
        policyType="quality"
        device={device}
        currentId={assignments?.quality?.id}
        isLoading={isLoadingAssignments || isLoadingQualities}
        emptyMessage={<T>No Quality Update Profiles created yet - create one in the Quality Updates tab first.</T>}
        options={(qualitiesData?.profiles || []).map((profile) => ({
          id: profile.id,
          label: profile.expedited ? `${profile.displayName} (expedited)` : profile.displayName,
        }))}
      />

      <PolicySelector
        label={<T>Driver Update Profile</T>}
        policyType="driver"
        device={device}
        currentId={assignments?.driver?.id}
        isLoading={isLoadingAssignments || isLoadingDrivers}
        emptyMessage={<T>No Driver Update Profiles created yet - create one in the Driver Updates tab first.</T>}
        options={(driversData?.profiles || []).map((profile) => ({
          id: profile.id,
          label: profile.displayName,
        }))}
      />

      <div className="pt-4 border-t border-overlay/10">
        <AnimatedEmptyState
          icon={MonitorCog}
          title={<T>More update types coming soon</T>}
          description={<T>M365 Apps update channel assignment for this device will appear here.</T>}
          showOrbs={false}
          color="neutral"
        />
      </div>
    </div>
  );
}
