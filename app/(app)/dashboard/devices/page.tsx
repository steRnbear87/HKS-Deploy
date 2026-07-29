'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { T } from 'gt-next';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertCircle,
  RefreshCw,
  Laptop,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Search,
  X,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  Filter,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useDevices } from '@/hooks/use-devices';
import {
  PageHeader,
  AnimatedEmptyState,
  SkeletonGrid,
  SkeletonTable,
  AnimatedStatCard,
  StatCardGrid,
} from '@/components/dashboard';
import { InventoryPagination } from '@/components/inventory';
import { usePagination } from '@/hooks/use-pagination';
import { STALE_DAYS, summarizeDeviceHealth, isStale, isNonCompliant } from '@/lib/intune/device-health';
import { getRegionForOfficeLocation } from '@/lib/intune/office-regions';
import { DeviceHealthTrendChart } from '@/components/devices/DeviceHealthTrendChart';
import { cn } from '@/lib/utils';
import type { DeviceComplianceState, ManagedDevice } from '@/types/devices';

const complianceTone: Record<DeviceComplianceState, StatusTone> = {
  compliant: 'success',
  noncompliant: 'error',
  conflict: 'error',
  error: 'error',
  inGracePeriod: 'warning',
  configManager: 'info',
  unknown: 'neutral',
};

const complianceLabel: Record<DeviceComplianceState, string> = {
  compliant: 'Compliant',
  noncompliant: 'Non-compliant',
  conflict: 'Conflict',
  error: 'Error',
  inGracePeriod: 'Grace period',
  configManager: 'Config Manager',
  unknown: 'Unknown',
};

const ownerTypeLabel: Record<ManagedDevice['managedDeviceOwnerType'], string> = {
  company: 'Company-owned',
  personal: 'Personal',
  unknown: 'Unknown',
};

// Graph's managementAgent enum is large and not fully enumerable here - cover
// the common values and fall back to humanizing anything unmapped so a
// device never renders a blank cell for an enum value we didn't anticipate.
const managementAgentLabelMap: Record<string, string> = {
  mdm: 'MDM',
  eas: 'Exchange ActiveSync',
  easMdm: 'EAS + MDM',
  intuneClient: 'Intune Client',
  configurationManagerClient: 'Config Manager',
  configurationManagerClientMdm: 'Config Manager + MDM',
  configurationManagerClientMdmEas: 'Config Manager + MDM + EAS',
  unknown: 'Unknown',
};

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function managementAgentLabel(value: string): string {
  return managementAgentLabelMap[value] ?? humanize(value);
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// RFC 4180: wrap in quotes and double any embedded quotes - same convention
// as app/api/analytics/export/route.ts's escapeCSV.
function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const CSV_COLUMNS: Array<{ header: string; getValue: (d: ManagedDevice) => string }> = [
  { header: 'Device', getValue: (d) => d.deviceName },
  { header: 'Managed by', getValue: (d) => managementAgentLabel(d.managementAgent) },
  { header: 'Ownership', getValue: (d) => ownerTypeLabel[d.managedDeviceOwnerType] },
  { header: 'Compliance', getValue: (d) => complianceLabel[d.complianceState] },
  { header: 'OS', getValue: (d) => d.operatingSystem },
  { header: 'OS version', getValue: (d) => d.osVersion || '' },
  { header: 'Primary user', getValue: (d) => d.userPrincipalName || '' },
  { header: 'Office location', getValue: (d) => d.officeLocation || '' },
  { header: 'Region', getValue: (d) => getRegionForOfficeLocation(d.officeLocation) },
  { header: 'Last check-in', getValue: (d) => formatDate(d.lastSyncDateTime) },
  { header: 'Enrollment date', getValue: (d) => formatDate(d.enrolledDateTime) },
  { header: 'Model', getValue: (d) => d.model || '' },
  { header: 'BIOS', getValue: (d) => d.biosVersion ?? '' },
];

function devicesToCsv(devices: ManagedDevice[]): string {
  const headerRow = CSV_COLUMNS.map((c) => escapeCsvValue(c.header)).join(',');
  const dataRows = devices.map((d) => CSV_COLUMNS.map((c) => escapeCsvValue(c.getValue(d))).join(','));
  return [headerRow, ...dataRows].join('\n');
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

type SortColumn =
  | 'deviceName'
  | 'managementAgent'
  | 'managedDeviceOwnerType'
  | 'complianceState'
  | 'operatingSystem'
  | 'osVersion'
  | 'userPrincipalName'
  | 'lastSyncDateTime'
  | 'enrolledDateTime'
  | 'model'
  | 'biosVersion'
  | 'officeLocation'
  | 'region';

type SortDirection = 'asc' | 'desc';

function getSortValue(device: ManagedDevice, column: SortColumn): string | number {
  switch (column) {
    case 'lastSyncDateTime':
    case 'enrolledDateTime': {
      const time = new Date(device[column]).getTime();
      return Number.isNaN(time) ? 0 : time;
    }
    case 'managementAgent':
      return managementAgentLabel(device.managementAgent);
    case 'managedDeviceOwnerType':
      return ownerTypeLabel[device.managedDeviceOwnerType];
    case 'complianceState':
      return complianceLabel[device.complianceState];
    case 'region':
      return getRegionForOfficeLocation(device.officeLocation);
    default:
      return device[column] ?? '';
  }
}

// Every sortable column is also filterable - the underlying filter value is
// always the raw field (so Set membership/equality checks stay simple and
// exact), with getFilterLabel handling the same value->label mappings
// getSortValue already applies for display. 'region' has no underlying
// ManagedDevice field - it's derived from officeLocation - so it's handled
// explicitly before the generic device[column] fallback.
type FilterColumn = SortColumn;

function getFilterValue(device: ManagedDevice, column: FilterColumn): string {
  if (column === 'region') return getRegionForOfficeLocation(device.officeLocation);
  return device[column] ?? '';
}

function getFilterLabel(column: FilterColumn, value: string): string {
  if (column === 'managementAgent') return managementAgentLabel(value);
  if (column === 'managedDeviceOwnerType') return ownerTypeLabel[value as ManagedDevice['managedDeviceOwnerType']] ?? value;
  if (column === 'complianceState') return complianceLabel[value as DeviceComplianceState] ?? value;
  if (column === 'lastSyncDateTime' || column === 'enrolledDateTime') return value ? formatDate(value) : '—';
  return value || '—';
}

interface SortableHeaderProps {
  label: string;
  column: SortColumn;
  sortColumn: SortColumn | null;
  sortDirection: SortDirection;
  onSort: (column: SortColumn) => void;
}

function SortableHeader({ label, column, sortColumn, sortDirection, onSort }: SortableHeaderProps) {
  const isActive = sortColumn === column;
  return (
    <button
      onClick={() => onSort(column)}
      className="flex items-center gap-1 hover:text-text-primary transition-colors"
    >
      {label}
      {isActive ? (
        sortDirection === 'asc' ? (
          <ArrowUp className="w-3 h-3" />
        ) : (
          <ArrowDown className="w-3 h-3" />
        )
      ) : (
        <ChevronsUpDown className="w-3 h-3 opacity-40" />
      )}
    </button>
  );
}

interface ColumnFilterProps {
  label: string;
  options: string[];
  column: FilterColumn;
  selected: Set<string>;
  onChange: (column: FilterColumn, value: string, checked: boolean) => void;
  onClear: (column: FilterColumn) => void;
}

function ColumnFilter({ label, options, column, selected, onChange, onClear }: ColumnFilterProps) {
  const isActive = selected.size > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center',
            isActive ? 'text-accent-cyan' : 'hover:text-text-primary transition-colors'
          )}
        >
          <Filter className="w-3 h-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-text-muted">No values</div>
        ) : (
          options.map((value) => (
            <DropdownMenuCheckboxItem
              key={value || '(empty)'}
              checked={selected.has(value)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(checked) => onChange(column, value, checked)}
            >
              {getFilterLabel(column, value)}
            </DropdownMenuCheckboxItem>
          ))
        )}
        {isActive && (
          <>
            <DropdownMenuSeparator />
            <button
              onClick={() => onClear(column)}
              className="w-full text-left px-2 py-1.5 text-xs text-accent-cyan hover:text-accent-cyan-bright"
            >
              Clear filter
            </button>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function DevicesPage() {
  const router = useRouter();
  const { data, isLoading, error, refetch, isFetching } = useDevices();
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<'all' | 'stale' | 'noncompliant'>('all');
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [columnFilters, setColumnFilters] = useState<Partial<Record<FilterColumn, Set<string>>>>({});
  const prefersReducedMotion = useReducedMotion();

  const devices = useMemo(() => data?.devices || [], [data]);

  const stats = useMemo(() => summarizeDeviceHealth(devices), [devices]);

  // Distinct values for filter dropdowns, derived from the full unfiltered
  // list so options don't shrink as other filters are applied.
  const filterOptions = useMemo(() => {
    const columns: FilterColumn[] = [
      'deviceName',
      'managementAgent',
      'managedDeviceOwnerType',
      'complianceState',
      'operatingSystem',
      'osVersion',
      'userPrincipalName',
      'lastSyncDateTime',
      'enrolledDateTime',
      'model',
      'biosVersion',
      'officeLocation',
      'region',
    ];
    const result: Record<FilterColumn, string[]> = {
      deviceName: [],
      managementAgent: [],
      managedDeviceOwnerType: [],
      complianceState: [],
      operatingSystem: [],
      osVersion: [],
      userPrincipalName: [],
      lastSyncDateTime: [],
      enrolledDateTime: [],
      model: [],
      biosVersion: [],
      officeLocation: [],
      region: [],
    };
    for (const column of columns) {
      result[column] = [...new Set(devices.map((d) => getFilterValue(d, column)))].sort();
    }
    return result;
  }, [devices]);

  const handleFilterChange = (column: FilterColumn, value: string, checked: boolean) => {
    setColumnFilters((prev) => {
      const next = new Set(prev[column] ?? []);
      if (checked) next.add(value);
      else next.delete(value);
      return { ...prev, [column]: next };
    });
  };

  const handleClearFilter = (column: FilterColumn) => {
    setColumnFilters((prev) => ({ ...prev, [column]: new Set() }));
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const activeFilterCount = Object.values(columnFilters).filter((s) => s && s.size > 0).length;

  const filteredDevices = useMemo(() => {
    let result = devices;
    if (healthFilter === 'stale') {
      result = result.filter((d) => isStale(d.lastSyncDateTime));
    } else if (healthFilter === 'noncompliant') {
      result = result.filter((d) => isNonCompliant(d.complianceState));
    }

    for (const [column, values] of Object.entries(columnFilters) as [FilterColumn, Set<string>][]) {
      if (values && values.size > 0) {
        result = result.filter((d) => values.has(getFilterValue(d, column)));
      }
    }

    if (search.trim()) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.deviceName.toLowerCase().includes(searchLower) ||
          d.userPrincipalName?.toLowerCase().includes(searchLower) ||
          d.model?.toLowerCase().includes(searchLower) ||
          d.serialNumber?.toLowerCase().includes(searchLower) ||
          d.officeLocation?.toLowerCase().includes(searchLower)
      );
    }

    if (sortColumn) {
      result = [...result].sort((a, b) => {
        const va = getSortValue(a, sortColumn);
        const vb = getSortValue(b, sortColumn);
        const comparison = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    return result;
  }, [devices, search, healthFilter, columnFilters, sortColumn, sortDirection]);

  const {
    pageItems,
    page,
    totalPages,
    nextPage,
    prevPage,
    canGoNext,
    canGoPrev,
    startIndex,
    endIndex,
    setPage,
  } = usePagination(filteredDevices, { pageSize: 24 });

  useEffect(() => {
    setPage(1);
  }, [search, healthFilter, columnFilters, sortColumn, sortDirection, setPage]);

  const handleExportCsv = () => {
    const csv = devicesToCsv(filteredDevices);
    const timestamp = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `devices-export-${timestamp}.csv`);
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: prefersReducedMotion ? {} : { staggerChildren: 0.03, delayChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: prefersReducedMotion ? { duration: 0.2 } : { duration: 0.3 },
    },
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={<T>Devices</T>} description={<T>Devices managed by Microsoft Intune</T>} />
        <SkeletonGrid count={4} columns={4} variant="stat" />
        <SkeletonTable rows={8} columns={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title={<T>Devices</T>} description={<T>Devices managed by Microsoft Intune</T>} />
        <AnimatedEmptyState
          icon={AlertCircle}
          title={<T>Failed to load devices</T>}
          description={error.message}
          color="neutral"
          action={{ label: 'Try Again', onClick: () => refetch(), variant: 'secondary' }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={<T>Devices</T>}
        description={<T>Devices managed by Microsoft Intune</T>}
        gradient
        gradientColors="mixed"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={filteredDevices.length === 0}
              className="text-text-secondary hover:text-text-primary"
            >
              <Download className="w-4 h-4 mr-2" />
              <T>Export CSV</T>
            </Button>
            <Button
              variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching}
              className="text-text-secondary hover:text-text-primary"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
              <T>Refresh</T>
            </Button>
          </div>
        }
      />

      {data?.partial && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-status-warning/10 border border-status-warning/20">
          <AlertCircle className="w-4 h-4 text-status-warning flex-shrink-0 mt-0.5" />
          <p className="text-xs text-text-muted">
            This list may be incomplete because Microsoft Graph responded slowly. Filtering and sorting only
            apply to what loaded so far - refresh to try loading the rest.
          </p>
        </div>
      )}

      {!bannerDismissed && (stats.stale > 0 || stats.nonCompliant > 0) && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-status-warning/10 border border-status-warning/20">
          <ShieldAlert className="w-4 h-4 text-status-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-text-secondary">
            {stats.stale > 0 && (
              <button
                onClick={() => setHealthFilter('stale')}
                className="underline decoration-dotted hover:text-text-primary transition-colors"
              >
                {stats.stale} device{stats.stale === 1 ? '' : 's'} haven&apos;t synced in {STALE_DAYS}+ days
              </button>
            )}
            {stats.stale > 0 && stats.nonCompliant > 0 && <span className="text-text-muted">·</span>}
            {stats.nonCompliant > 0 && (
              <button
                onClick={() => setHealthFilter('noncompliant')}
                className="underline decoration-dotted hover:text-text-primary transition-colors"
              >
                {stats.nonCompliant} device{stats.nonCompliant === 1 ? '' : 's'} non-compliant
              </button>
            )}
          </div>
          <button
            onClick={() => setBannerDismissed(true)}
            className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {devices.length > 0 && (
        <StatCardGrid columns={4}>
          <AnimatedStatCard title={<T>Total Devices</T>} value={stats.total} icon={Laptop} color="cyan" delay={0} />
          <AnimatedStatCard title={<T>Compliant</T>} value={stats.compliant} icon={ShieldCheck} color="success" delay={0.1} />
          <AnimatedStatCard title={<T>Non-compliant</T>} value={stats.nonCompliant} icon={ShieldAlert} color="error" delay={0.2} />
          <AnimatedStatCard
            title={<T>Not Synced Recently</T>}
            value={stats.stale}
            icon={Clock}
            color="neutral"
            delay={0.3}
            description={<T>{`Over ${STALE_DAYS} days`}</T>}
          />
        </StatCardGrid>
      )}

      {devices.length > 0 && <DeviceHealthTrendChart />}

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by device name, user, model, serial number, or office location..."
            className="pl-9 bg-bg-elevated border-overlay/10 focus:border-accent-cyan/50"
          />
        </div>
        {(healthFilter !== 'all' || activeFilterCount > 0) && (
          <div className="flex items-center gap-2 mt-2 text-xs text-text-muted">
            <span>
              {healthFilter !== 'all' && `Filtered to ${healthFilter === 'stale' ? 'stale' : 'non-compliant'} devices`}
              {healthFilter !== 'all' && activeFilterCount > 0 && ' · '}
              {activeFilterCount > 0 && `${activeFilterCount} column filter${activeFilterCount === 1 ? '' : 's'} active`}
            </span>
            <button
              onClick={() => {
                setHealthFilter('all');
                setColumnFilters({});
              }}
              className="text-accent-cyan hover:text-accent-cyan-bright underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </motion.div>

      {filteredDevices.length > 0 ? (
        <>
          <div className="overflow-x-auto glass-light rounded-xl border border-overlay/5">
            <table className="w-full min-w-[1400px]">
              <thead>
                <tr className="border-b border-overlay/15">
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
                    <div className="flex items-center gap-1.5">
                      <SortableHeader label="Device" column="deviceName" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <ColumnFilter
                        label="Device"
                        options={filterOptions.deviceName}
                        column="deviceName"
                        selected={columnFilters.deviceName ?? new Set()}
                        onChange={handleFilterChange}
                        onClear={handleClearFilter}
                      />
                    </div>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <SortableHeader label="Managed by" column="managementAgent" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <ColumnFilter
                        label="Managed by"
                        options={filterOptions.managementAgent}
                        column="managementAgent"
                        selected={columnFilters.managementAgent ?? new Set()}
                        onChange={handleFilterChange}
                        onClear={handleClearFilter}
                      />
                    </div>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <SortableHeader label="Ownership" column="managedDeviceOwnerType" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <ColumnFilter
                        label="Ownership"
                        options={filterOptions.managedDeviceOwnerType}
                        column="managedDeviceOwnerType"
                        selected={columnFilters.managedDeviceOwnerType ?? new Set()}
                        onChange={handleFilterChange}
                        onClear={handleClearFilter}
                      />
                    </div>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
                    <div className="flex items-center gap-1.5">
                      <SortableHeader label="Compliance" column="complianceState" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <ColumnFilter
                        label="Compliance"
                        options={filterOptions.complianceState}
                        column="complianceState"
                        selected={columnFilters.complianceState ?? new Set()}
                        onChange={handleFilterChange}
                        onClear={handleClearFilter}
                      />
                    </div>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <SortableHeader label="OS" column="operatingSystem" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <ColumnFilter
                        label="OS"
                        options={filterOptions.operatingSystem}
                        column="operatingSystem"
                        selected={columnFilters.operatingSystem ?? new Set()}
                        onChange={handleFilterChange}
                        onClear={handleClearFilter}
                      />
                    </div>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <SortableHeader label="OS version" column="osVersion" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <ColumnFilter
                        label="OS version"
                        options={filterOptions.osVersion}
                        column="osVersion"
                        selected={columnFilters.osVersion ?? new Set()}
                        onChange={handleFilterChange}
                        onClear={handleClearFilter}
                      />
                    </div>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
                    <div className="flex items-center gap-1.5">
                      <SortableHeader label="Primary user" column="userPrincipalName" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <ColumnFilter
                        label="Primary user"
                        options={filterOptions.userPrincipalName}
                        column="userPrincipalName"
                        selected={columnFilters.userPrincipalName ?? new Set()}
                        onChange={handleFilterChange}
                        onClear={handleClearFilter}
                      />
                    </div>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <SortableHeader label="Office location" column="officeLocation" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <ColumnFilter
                        label="Office location"
                        options={filterOptions.officeLocation}
                        column="officeLocation"
                        selected={columnFilters.officeLocation ?? new Set()}
                        onChange={handleFilterChange}
                        onClear={handleClearFilter}
                      />
                    </div>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <SortableHeader label="Region" column="region" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <ColumnFilter
                        label="Region"
                        options={filterOptions.region}
                        column="region"
                        selected={columnFilters.region ?? new Set()}
                        onChange={handleFilterChange}
                        onClear={handleClearFilter}
                      />
                    </div>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <SortableHeader label="Last check-in" column="lastSyncDateTime" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <ColumnFilter
                        label="Last check-in"
                        options={filterOptions.lastSyncDateTime}
                        column="lastSyncDateTime"
                        selected={columnFilters.lastSyncDateTime ?? new Set()}
                        onChange={handleFilterChange}
                        onClear={handleClearFilter}
                      />
                    </div>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <SortableHeader label="Enrollment date" column="enrolledDateTime" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <ColumnFilter
                        label="Enrollment date"
                        options={filterOptions.enrolledDateTime}
                        column="enrolledDateTime"
                        selected={columnFilters.enrolledDateTime ?? new Set()}
                        onChange={handleFilterChange}
                        onClear={handleClearFilter}
                      />
                    </div>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <SortableHeader label="Model" column="model" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <ColumnFilter
                        label="Model"
                        options={filterOptions.model}
                        column="model"
                        selected={columnFilters.model ?? new Set()}
                        onChange={handleFilterChange}
                        onClear={handleClearFilter}
                      />
                    </div>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <SortableHeader label="BIOS" column="biosVersion" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                      <ColumnFilter
                        label="BIOS"
                        options={filterOptions.biosVersion}
                        column="biosVersion"
                        selected={columnFilters.biosVersion ?? new Set()}
                        onChange={handleFilterChange}
                        onClear={handleClearFilter}
                      />
                    </div>
                  </th>
                </tr>
              </thead>
              <motion.tbody key={page} variants={containerVariants} initial="hidden" animate="visible">
                {pageItems.map((device) => (
                  <motion.tr
                    key={device.id}
                    variants={itemVariants}
                    onClick={() => router.push(`/dashboard/devices/${device.id}`)}
                    className="border-b border-overlay/10 hover:bg-bg-elevated/30 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-4">
                      <p className="text-sm font-medium text-text-primary whitespace-nowrap">{device.deviceName}</p>
                    </td>
                    <td className="py-3 px-4 text-sm text-text-secondary whitespace-nowrap">
                      {managementAgentLabel(device.managementAgent)}
                    </td>
                    <td className="py-3 px-4 text-sm text-text-secondary whitespace-nowrap">
                      {ownerTypeLabel[device.managedDeviceOwnerType]}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge tone={complianceTone[device.complianceState]}>
                        {complianceLabel[device.complianceState]}
                      </StatusBadge>
                    </td>
                    <td className="py-3 px-4 text-sm text-text-secondary whitespace-nowrap">{device.operatingSystem}</td>
                    <td className="py-3 px-4 text-sm text-text-secondary whitespace-nowrap">{device.osVersion || '—'}</td>
                    <td className="py-3 px-4 text-sm text-text-secondary">{device.userPrincipalName || '—'}</td>
                    <td className="py-3 px-4 text-sm text-text-secondary whitespace-nowrap">{device.officeLocation || '—'}</td>
                    <td className="py-3 px-4 text-sm text-text-secondary whitespace-nowrap">
                      {getRegionForOfficeLocation(device.officeLocation)}
                    </td>
                    <td className="py-3 px-4 text-sm text-text-muted whitespace-nowrap">
                      {formatDate(device.lastSyncDateTime)}
                    </td>
                    <td className="py-3 px-4 text-sm text-text-muted whitespace-nowrap">
                      {formatDate(device.enrolledDateTime)}
                    </td>
                    <td className="py-3 px-4 text-sm text-text-secondary whitespace-nowrap">{device.model || '—'}</td>
                    <td
                      className="py-3 px-4 text-sm text-text-secondary whitespace-nowrap"
                      title={device.biosCapturedAt ? `As of ${formatDate(device.biosCapturedAt)}` : undefined}
                    >
                      {device.biosVersion ?? (device.biosCapturedAt ? '—' : 'Not yet scanned')}
                    </td>
                  </motion.tr>
                ))}
              </motion.tbody>
            </table>
          </div>
          <InventoryPagination
            page={page}
            totalPages={totalPages}
            startIndex={startIndex}
            endIndex={endIndex}
            totalItems={filteredDevices.length}
            canGoNext={canGoNext}
            canGoPrev={canGoPrev}
            onNextPage={nextPage}
            onPrevPage={prevPage}
          />
        </>
      ) : devices.length > 0 ? (
        <AnimatedEmptyState
          icon={Laptop}
          title={<T>No devices match your search</T>}
          description={<T>Try adjusting your search or filter criteria</T>}
          color="neutral"
          showOrbs={false}
          action={{
            label: 'Clear Search',
            onClick: () => {
              setSearch('');
              setColumnFilters({});
              setHealthFilter('all');
            },
            variant: 'secondary',
          }}
        />
      ) : (
        <AnimatedEmptyState
          icon={Laptop}
          title={<T>No devices found</T>}
          description={<T>Devices enrolled in Intune will appear here</T>}
          color="cyan"
        />
      )}
    </div>
  );
}
