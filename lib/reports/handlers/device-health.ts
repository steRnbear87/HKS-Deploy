/**
 * Device Health report handlers. Stale Devices is a pure filter over the
 * live fleet-device sweep using the existing isStale() threshold
 * (lib/intune/device-health.ts). Battery Health Status / Disk Space read the
 * device_bios_info cache (populated by lib/device-health/bios-snapshot.ts,
 * widened to capture these fields alongside BIOS version) rather than
 * calling Graph live - same "read the cache" pattern as the Autopilot report.
 */

import { getDatabase } from '@/lib/db';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { isStale } from '@/lib/intune/device-health';
import { fetchFleetDevicesForReports } from '@/lib/reports/fleet-devices';
import type { ReportHandler } from '@/types/reports';

export const staleDevices: ReportHandler = async (tenantId) => {
  const token = await getServicePrincipalToken(tenantId);
  if (!token) throw new Error('Failed to get Graph API token');

  const { devices, partial } = await fetchFleetDevicesForReports(tenantId, token);

  const columns = [
    { key: 'device', label: 'Device' },
    { key: 'os', label: 'OS' },
    { key: 'lastCheckIn', label: 'Last Check-in' },
  ];

  const rows = devices
    .filter((d) => !d.lastSyncDateTime || isStale(d.lastSyncDateTime))
    .map((d) => ({
      device: d.deviceName || 'Unknown device',
      os: d.operatingSystem || 'Unknown',
      lastCheckIn: d.lastSyncDateTime ? new Date(d.lastSyncDateTime).toLocaleString() : 'Never',
    }));

  return { chartType: 'table', columns, rows, generatedAt: new Date().toISOString(), partial };
};

function bucketPercentage(value: number | null, buckets: Array<{ label: string; min: number }>): string {
  if (value === null) return 'Unknown';
  for (const bucket of buckets) {
    if (value >= bucket.min) return bucket.label;
  }
  return 'Unknown';
}

const BATTERY_BUCKETS = [
  { label: 'Good (80-100%)', min: 80 },
  { label: 'Fair (50-79%)', min: 50 },
  { label: 'Poor (<50%)', min: 0 },
];

export const batteryHealthStatus: ReportHandler = async (tenantId) => {
  const rows = await getDatabase().deviceBiosInfo.getByTenantId(tenantId);

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.battery_health_percentage === null) continue; // non-battery devices (desktops) shouldn't dilute "Unknown"
    const bucket = bucketPercentage(row.battery_health_percentage, BATTERY_BUCKETS);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  const order = ['Good (80-100%)', 'Fair (50-79%)', 'Poor (<50%)'];
  const data = order
    .filter((label) => counts.has(label))
    .map((label) => ({ label, value: counts.get(label) as number }));

  return { chartType: 'bar', data, generatedAt: new Date().toISOString() };
};

const FREE_SPACE_BUCKETS = [
  { label: '>50% free', min: 50 },
  { label: '25-50% free', min: 25 },
  { label: '10-25% free', min: 10 },
  { label: '<10% free', min: 0 },
];

export const diskSpace: ReportHandler = async (tenantId) => {
  const rows = await getDatabase().deviceBiosInfo.getByTenantId(tenantId);

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.total_storage_bytes || row.free_storage_bytes === null) continue;
    const percentFree = (row.free_storage_bytes / row.total_storage_bytes) * 100;
    const bucket = bucketPercentage(percentFree, FREE_SPACE_BUCKETS);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  const order = ['>50% free', '25-50% free', '10-25% free', '<10% free'];
  const data = order
    .filter((label) => counts.has(label))
    .map((label) => ({ label, value: counts.get(label) as number }));

  return { chartType: 'bar', data, generatedAt: new Date().toISOString() };
};

export const deviceHealthHandlers: Record<string, ReportHandler> = {
  'stale-devices': staleDevices,
  'battery-health-status': batteryHealthStatus,
  'disk-space': diskSpace,
};
