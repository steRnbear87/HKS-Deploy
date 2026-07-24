'use client';

import { useMemo, useState } from 'react';
import {
  MonitorCog,
  ShieldCheck,
  HardDrive,
  Layers,
  ChevronDown,
  ExternalLink,
  AlertTriangle,
  Zap,
  Calendar,
  Users,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { T } from 'gt-next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  useUpdateCatalog,
  useAllDriverInventory,
  useUpdateRings,
} from '@/hooks/use-windows-updates';
import { useDevices } from '@/hooks/use-devices';
import {
  buildFeatureVersionMap,
  computeFeatureAdoption,
  computeQualityAdoption,
} from '@/lib/intune/windows-update-compliance';
import type {
  FeatureUpdateCatalogItem,
  QualityUpdateCatalogItem,
  DriverInventoryItemWithProfile,
  UpdateRing,
  UpdateAdoptionStats,
} from '@/types/windows-updates';

type CatalogSectionType = 'feature' | 'quality' | 'driver' | 'ring';
type DetailState =
  | { type: 'feature'; item: FeatureUpdateCatalogItem }
  | { type: 'quality'; item: QualityUpdateCatalogItem }
  | { type: 'driver'; item: DriverInventoryItemWithProfile }
  | { type: 'ring'; item: UpdateRing }
  | null;

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-400 border-red-500/20',
  important: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  moderate: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  low: 'bg-overlay/10 text-text-muted border-overlay/20',
};

interface CatalogCardProps {
  icon: LucideIcon;
  label: React.ReactNode;
  count: number | null;
  isLoading: boolean;
  isExpanded: boolean;
  onClick: () => void;
}

function CatalogCard({ icon: Icon, label, count, isLoading, isExpanded, onClick }: CatalogCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'glass-light border rounded-xl p-4 text-left transition-colors',
        isExpanded ? 'border-accent-cyan/30 bg-accent-cyan/[0.03]' : 'border-overlay/5 hover:border-overlay/10'
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={cn('p-2 rounded-lg', isExpanded ? 'bg-accent-cyan/10' : 'bg-overlay/5')}>
          <Icon className={cn('w-4 h-4', isExpanded ? 'text-accent-cyan' : 'text-text-muted')} />
        </div>
        <ChevronDown className={cn('w-4 h-4 text-text-muted transition-transform', isExpanded && 'rotate-180')} />
      </div>
      <div className="text-2xl font-bold text-text-primary">{isLoading ? '—' : count}</div>
      <div className="text-sm text-text-muted">{label}</div>
    </button>
  );
}

/** "X of Y devices" fleet-adoption pill - null-safe, renders nothing when
 * there's no applicable device in the fleet for this release (e.g. no
 * Windows devices reporting osVersion yet). */
function AdoptionBadge({ stats }: { stats: UpdateAdoptionStats | undefined }) {
  if (!stats || stats.applicable === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent-cyan/10 border border-accent-cyan/20 text-sm font-semibold text-accent-cyan flex-shrink-0">
      <Users className="w-4 h-4" />
      {stats.compliant}/{stats.applicable} <span className="font-normal text-accent-cyan/80"><T>devices</T></span>
    </span>
  );
}

/** Bigger, standalone version of the adoption stat for detail dialogs - the
 * count is the headline, not an inline aside. */
function FleetAdoptionCallout({ stats, label }: { stats: UpdateAdoptionStats | undefined; label: React.ReactNode }) {
  if (!stats || stats.applicable === 0) return null;
  const pct = Math.round((stats.compliant / stats.applicable) * 100);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20">
      <Users className="w-5 h-5 text-accent-cyan flex-shrink-0" />
      <div>
        <div className="text-xl font-bold text-accent-cyan leading-tight">
          {stats.compliant}/{stats.applicable} <span className="text-sm font-normal text-accent-cyan/80">({pct}%)</span>
        </div>
        <div className="text-xs text-text-secondary">{label}</div>
      </div>
    </div>
  );
}

function CatalogSearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative px-3 pt-3 pb-2 border-b border-overlay/5">
      <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-8 pr-3 py-1.5 bg-bg-elevated border border-overlay/10 rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan/40"
      />
    </div>
  );
}

export function ReleaseCatalogSection() {
  const [expanded, setExpanded] = useState<CatalogSectionType | null>(null);
  const [detail, setDetail] = useState<DetailState>(null);
  const [search, setSearch] = useState('');

  const { data: catalogData, isLoading: isLoadingCatalog } = useUpdateCatalog();
  const { data: driversData, isLoading: isLoadingDrivers } = useAllDriverInventory();
  const { data: ringsData, isLoading: isLoadingRings } = useUpdateRings();
  const { data: devicesData } = useDevices();

  const devices = useMemo(() => devicesData?.devices ?? [], [devicesData]);

  const versionBuildMap = useMemo(
    () => buildFeatureVersionMap(catalogData?.quality ?? []),
    [catalogData?.quality]
  );

  const featureAdoption = useMemo(() => {
    const map = new Map<string, UpdateAdoptionStats>();
    for (const item of catalogData?.feature ?? []) {
      map.set(item.id, computeFeatureAdoption(devices, item, versionBuildMap));
    }
    return map;
  }, [catalogData?.feature, devices, versionBuildMap]);

  const qualityAdoption = useMemo(() => {
    const map = new Map<string, UpdateAdoptionStats>();
    for (const item of catalogData?.quality ?? []) {
      map.set(item.id, computeQualityAdoption(devices, item));
    }
    return map;
  }, [catalogData?.quality, devices]);

  const toggle = (type: CatalogSectionType) => {
    setExpanded((prev) => (prev === type ? null : type));
    setSearch('');
  };

  const query = search.trim().toLowerCase();
  const filteredFeature = (catalogData?.feature || []).filter((item) =>
    !query || item.displayName.toLowerCase().includes(query)
  );
  const filteredQuality = (catalogData?.quality || []).filter((item) =>
    !query ||
    item.displayName.toLowerCase().includes(query) ||
    item.productRevisions.some((r) => r.kbArticleId?.toLowerCase().includes(query))
  );
  const filteredDrivers = (driversData?.drivers || []).filter((item) =>
    !query ||
    item.name.toLowerCase().includes(query) ||
    item.manufacturer?.toLowerCase().includes(query) ||
    item.profileName.toLowerCase().includes(query)
  );
  const filteredRings = (ringsData?.rings || []).filter((item) =>
    !query || item.displayName.toLowerCase().includes(query)
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <CatalogCard
          icon={MonitorCog}
          label={<T>Feature Updates</T>}
          count={catalogData?.feature.length ?? null}
          isLoading={isLoadingCatalog}
          isExpanded={expanded === 'feature'}
          onClick={() => toggle('feature')}
        />
        <CatalogCard
          icon={ShieldCheck}
          label={<T>Quality Updates</T>}
          count={catalogData?.quality.length ?? null}
          isLoading={isLoadingCatalog}
          isExpanded={expanded === 'quality'}
          onClick={() => toggle('quality')}
        />
        <CatalogCard
          icon={HardDrive}
          label={<T>Driver Updates</T>}
          count={driversData?.count ?? null}
          isLoading={isLoadingDrivers}
          isExpanded={expanded === 'driver'}
          onClick={() => toggle('driver')}
        />
        <CatalogCard
          icon={Layers}
          label={<T>Update Rings</T>}
          count={ringsData?.count ?? null}
          isLoading={isLoadingRings}
          isExpanded={expanded === 'ring'}
          onClick={() => toggle('ring')}
        />
      </div>

      {expanded === 'feature' && (
        <div className="glass-light border border-overlay/5 rounded-xl overflow-hidden">
          <CatalogSearchInput value={search} onChange={setSearch} placeholder="Search feature updates..." />
          <div className="divide-y divide-overlay/5 max-h-96 overflow-y-auto">
            {filteredFeature.length === 0 ? (
              <p className="text-sm text-text-muted px-4 py-6 text-center"><T>No matching releases.</T></p>
            ) : (
              filteredFeature.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setDetail({ type: 'feature', item })}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-overlay/5 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{item.displayName}</div>
                    <div className="text-xs text-text-muted">
                      <T>Released</T> {formatDate(item.releaseDateTime)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs text-text-muted">
                      <T>End of support</T> {formatDate(item.endOfSupportDate)}
                    </span>
                    <AdoptionBadge stats={featureAdoption.get(item.id)} />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {expanded === 'quality' && (
        <div className="glass-light border border-overlay/5 rounded-xl overflow-hidden">
          <CatalogSearchInput value={search} onChange={setSearch} placeholder="Search quality updates or KB number..." />
          <div className="divide-y divide-overlay/5 max-h-96 overflow-y-auto">
            {filteredQuality.length === 0 ? (
              <p className="text-sm text-text-muted px-4 py-6 text-center"><T>No matching releases.</T></p>
            ) : (
              filteredQuality.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setDetail({ type: 'quality', item })}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-overlay/5 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-text-primary truncate">{item.displayName}</div>
                      {item.isExpeditable && <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                    </div>
                    <div className="text-xs text-text-muted">
                      <T>Released</T> {formatDate(item.releaseDateTime)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {item.cveSeverityInformation?.maxSeverityLevel && (
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-xs font-medium border',
                          SEVERITY_STYLES[item.cveSeverityInformation.maxSeverityLevel.toLowerCase()] || SEVERITY_STYLES.low
                        )}
                      >
                        {item.cveSeverityInformation.maxSeverityLevel}
                      </span>
                    )}
                    <AdoptionBadge stats={qualityAdoption.get(item.id)} />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {expanded === 'driver' && (
        <div className="glass-light border border-overlay/5 rounded-xl overflow-hidden">
          <CatalogSearchInput value={search} onChange={setSearch} placeholder="Search drivers, manufacturers, profiles..." />
          <div className="divide-y divide-overlay/5 max-h-96 overflow-y-auto">
            {(driversData?.drivers || []).length === 0 ? (
              <p className="text-sm text-text-muted px-4 py-6 text-center">
                <T>No drivers reported yet - create a Driver Update Profile and assign it to a device.</T>
              </p>
            ) : filteredDrivers.length === 0 ? (
              <p className="text-sm text-text-muted px-4 py-6 text-center"><T>No matching drivers.</T></p>
            ) : (
              filteredDrivers.map((item) => (
                <button
                  key={`${item.profileId}-${item.id}`}
                  onClick={() => setDetail({ type: 'driver', item })}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-overlay/5 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{item.name}</div>
                    <div className="text-xs text-text-muted">
                      {item.manufacturer} &middot; v{item.version} &middot; {item.profileName}
                    </div>
                  </div>
                  <span className="text-xs font-medium text-text-muted flex-shrink-0">{item.approvalStatus}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {expanded === 'ring' && (
        <div className="glass-light border border-overlay/5 rounded-xl overflow-hidden">
          <CatalogSearchInput value={search} onChange={setSearch} placeholder="Search update rings..." />
          <div className="divide-y divide-overlay/5 max-h-96 overflow-y-auto">
            {filteredRings.length === 0 ? (
              <p className="text-sm text-text-muted px-4 py-6 text-center"><T>No matching rings.</T></p>
            ) : (
              filteredRings.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setDetail({ type: 'ring', item })}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-overlay/5 transition-colors"
                >
                  <div className="text-sm font-medium text-text-primary">{item.displayName}</div>
                  <span className="text-xs text-text-muted flex-shrink-0">
                    Q:{item.qualityUpdatesDeferralPeriodInDays}d / F:{item.featureUpdatesDeferralPeriodInDays}d
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-lg">
          {detail?.type === 'feature' && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.item.displayName}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-text-secondary">
                  <Calendar className="w-4 h-4" />
                  <T>Released</T> {formatDate(detail.item.releaseDateTime)}
                </div>
                <div className="flex items-center gap-2 text-text-secondary">
                  <AlertTriangle className="w-4 h-4" />
                  <T>End of support</T> {formatDate(detail.item.endOfSupportDate)}
                </div>
                <FleetAdoptionCallout stats={featureAdoption.get(detail.item.id)} label={<T>devices on this version</T>} />
                <div className="text-text-muted text-xs">
                  <T>Version identifier</T>: {detail.item.version}
                </div>
              </div>
            </>
          )}

          {detail?.type === 'quality' && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.item.displayName}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-text-secondary">
                  <Calendar className="w-4 h-4" />
                  <T>Released</T> {formatDate(detail.item.releaseDateTime)}
                </div>
                {detail.item.classification && (
                  <div className="text-text-secondary">
                    <T>Classification</T>: {detail.item.classification}
                  </div>
                )}
                {detail.item.isExpeditable && (
                  <div className="flex items-center gap-2 text-amber-400">
                    <Zap className="w-4 h-4" />
                    <T>Eligible for expedited deployment</T>
                  </div>
                )}
                {detail.item.cveSeverityInformation?.maxSeverityLevel && (
                  <div
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium',
                      SEVERITY_STYLES[detail.item.cveSeverityInformation.maxSeverityLevel.toLowerCase()] ||
                        SEVERITY_STYLES.low
                    )}
                  >
                    <T>Max CVE severity</T>: {detail.item.cveSeverityInformation.maxSeverityLevel}
                    {detail.item.cveSeverityInformation.exploitedCves.length > 0 &&
                      ` · ${detail.item.cveSeverityInformation.exploitedCves.length} exploited CVE(s)`}
                  </div>
                )}
                <FleetAdoptionCallout stats={qualityAdoption.get(detail.item.id)} label={<T>devices on this update or later</T>} />
                {detail.item.productRevisions.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-text-muted"><T>Per-version builds</T></p>
                    <div className="rounded-lg border border-overlay/10 divide-y divide-overlay/5">
                      {detail.item.productRevisions.map((revision, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
                          <span className="text-text-secondary">
                            {revision.productName} {revision.versionName} · build {revision.buildNumber}.{revision.updateBuildRevision}
                          </span>
                          {revision.kbArticleUrl && revision.kbArticleId ? (
                            <a
                              href={revision.kbArticleUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-accent-cyan hover:underline flex-shrink-0"
                            >
                              <ExternalLink className="w-3 h-3" />
                              {revision.kbArticleId}
                            </a>
                          ) : (
                            <span className="text-text-muted flex-shrink-0">—</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted"><T>No per-version build detail available for this release.</T></p>
                )}
              </div>
            </>
          )}

          {detail?.type === 'driver' && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.item.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm text-text-secondary">
                <div><T>Manufacturer</T>: {detail.item.manufacturer || '—'}</div>
                <div><T>Version</T>: {detail.item.version}</div>
                <div><T>Category</T>: {detail.item.category || '—'}</div>
                <div><T>Profile</T>: {detail.item.profileName}</div>
                <div><T>Approval status</T>: {detail.item.approvalStatus}</div>
                {detail.item.applicableDeviceCount != null && (
                  <div><T>Applicable devices</T>: {detail.item.applicableDeviceCount}</div>
                )}
              </div>
            </>
          )}

          {detail?.type === 'ring' && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.item.displayName}</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm text-text-secondary">
                <div><T>Quality update deferral</T>: {detail.item.qualityUpdatesDeferralPeriodInDays} <T>days</T></div>
                <div><T>Feature update deferral</T>: {detail.item.featureUpdatesDeferralPeriodInDays} <T>days</T></div>
                <div><T>Quality updates paused</T>: {detail.item.qualityUpdatesPaused ? 'Yes' : 'No'}</div>
                <div><T>Feature updates paused</T>: {detail.item.featureUpdatesPaused ? 'Yes' : 'No'}</div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
