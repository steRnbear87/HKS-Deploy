'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, ExternalLink, MonitorCog, ShieldCheck, type LucideIcon } from 'lucide-react';
import { T } from 'gt-next';
import { cn } from '@/lib/utils';
import { useUpdateCatalog } from '@/hooks/use-windows-updates';
import {
  buildFeatureVersionMap,
  computeDeviceFeatureStatus,
  computeDeviceQualityStatus,
  parseOsVersion,
} from '@/lib/intune/windows-update-compliance';
import type { ManagedDevice } from '@/types/devices';

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const MAX_MISSING_SHOWN = 3;

interface StatusCardProps {
  icon: LucideIcon;
  tone: 'good' | 'attention';
  title: React.ReactNode;
  headline: React.ReactNode;
  subtitle: React.ReactNode;
  children?: React.ReactNode;
}

function StatusCard({ icon: Icon, tone, title, headline, subtitle, children }: StatusCardProps) {
  const good = tone === 'good';
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        good ? 'bg-green-500/[0.04] border-green-500/15' : 'bg-amber-500/[0.04] border-amber-500/15'
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className={cn('p-1.5 rounded-lg', good ? 'bg-green-500/10' : 'bg-amber-500/10')}>
          <Icon className={cn('w-4 h-4', good ? 'text-green-400' : 'text-amber-400')} />
        </div>
        <span className="text-xs font-medium text-text-muted">{title}</span>
      </div>
      <div className={cn('text-lg font-bold leading-tight', good ? 'text-green-400' : 'text-amber-400')}>
        {headline}
      </div>
      <div className="text-xs text-text-secondary mt-0.5">{subtitle}</div>
      {children}
    </div>
  );
}

/**
 * "What updates has this device installed, and what's it missing" - derived
 * purely from the device's reported osVersion build/UBR against the
 * Microsoft-published release catalog (no Log Analytics/WUfB reporting
 * required, unlike the read-only reporting on the Devices page).
 */
export function DeviceUpdateStatusSection({ device }: { device: ManagedDevice }) {
  const { data: catalogData, isLoading } = useUpdateCatalog();
  const [showAllMissing, setShowAllMissing] = useState(false);

  const parsedVersion = useMemo(() => parseOsVersion(device.osVersion), [device.osVersion]);

  const versionBuildMap = useMemo(
    () => buildFeatureVersionMap(catalogData?.quality ?? []),
    [catalogData?.quality]
  );

  const featureStatus = useMemo(
    () => (catalogData ? computeDeviceFeatureStatus(device.osVersion, catalogData.feature, versionBuildMap) : null),
    [catalogData, device.osVersion, versionBuildMap]
  );

  const qualityStatus = useMemo(
    () => (catalogData ? computeDeviceQualityStatus(device.osVersion, catalogData.quality) : null),
    [catalogData, device.osVersion]
  );

  if (isLoading) {
    return <p className="text-sm text-text-muted"><T>Checking update status...</T></p>;
  }

  // Not a recognizable Windows build string, or catalog unavailable - say nothing.
  if (!parsedVersion || (!featureStatus?.current && !qualityStatus)) {
    return null;
  }

  const missingToShow = qualityStatus
    ? showAllMissing
      ? qualityStatus.missing
      : qualityStatus.missing.slice(0, MAX_MISSING_SHOWN)
    : [];
  const extraMissingCount = qualityStatus ? qualityStatus.missing.length - missingToShow.length : 0;
  const featureUpToDate = !featureStatus?.current || featureStatus.available.length === 0;
  const qualityUpToDate = !qualityStatus || qualityStatus.missing.length === 0;

  return (
    <div className="space-y-3 pb-5 mb-5 border-b border-overlay/10">
      <h4 className="text-sm font-semibold text-text-primary"><T>Update Status</T></h4>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {featureStatus?.current && (
          <StatusCard
            icon={MonitorCog}
            tone={featureUpToDate ? 'good' : 'attention'}
            title={<T>Feature Version</T>}
            headline={featureStatus.current.displayName.replace('Windows 11, version ', '').replace('Windows 10, version ', '')}
            subtitle={featureStatus.current.displayName}
          >
            {!featureUpToDate && (
              <div className="mt-2.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <T>Newer available</T>: {featureStatus!.available[featureStatus!.available.length - 1].displayName}
              </div>
            )}
          </StatusCard>
        )}

        {qualityStatus && (
          <StatusCard
            icon={ShieldCheck}
            tone={qualityUpToDate ? 'good' : 'attention'}
            title={<T>Quality Updates</T>}
            headline={
              qualityUpToDate ? (
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> <T>Up to date</T>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" /> {qualityStatus.missing.length} <T>missing</T>
                </span>
              )
            }
            subtitle={
              qualityUpToDate
                ? qualityStatus.installed[0]
                  ? <><T>Last installed</T>: {qualityStatus.installed[0].displayName}</>
                  : <T>No applicable releases found</T>
                : <T>This device is behind on cumulative updates</T>
            }
          >
            {!qualityUpToDate && (
              <div className="mt-3 rounded-lg border border-overlay/10 divide-y divide-overlay/5 bg-bg-elevated/40 overflow-hidden">
                {missingToShow.map((item) => {
                  const revision = item.productRevisions.find((r) => r.buildNumber === parsedVersion.buildNumber);
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                      <div className="min-w-0">
                        <div className="text-text-secondary truncate">{item.displayName}</div>
                        <div className="text-text-muted">{formatDate(item.releaseDateTime)}</div>
                      </div>
                      {revision?.kbArticleUrl && revision.kbArticleId && (
                        <a
                          href={revision.kbArticleUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 transition-colors flex-shrink-0"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {revision.kbArticleId}
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {extraMissingCount > 0 && (
              <button
                onClick={() => setShowAllMissing(true)}
                className="mt-2 text-xs text-accent-cyan hover:underline"
              >
                +{extraMissingCount} <T>more</T>
              </button>
            )}
          </StatusCard>
        )}
      </div>
    </div>
  );
}
