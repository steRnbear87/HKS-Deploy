/**
 * Users report handlers - GROUP BY userPrincipalName over the live
 * fleet-device sweep (lib/reports/fleet-devices.ts). No new Graph calls;
 * userPrincipalName is already on every managedDevice record.
 *
 * Users with App Deployment Issues stays 'coming-soon' in the registry
 * (alongside Users with Configuration Issues) - our packaging-job records
 * track the admin who ran the job, not the end-user whose device an app
 * deploys to, so there's no per-device install failure attributable to an
 * end-user today.
 */

import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { isNonCompliant } from '@/lib/intune/device-health';
import { listQualityUpdateCatalog } from '@/lib/intune/windows-update-catalog';
import { computeDeviceQualityStatus } from '@/lib/intune/windows-update-compliance';
import { fetchFleetDevicesForReports } from '@/lib/reports/fleet-devices';
import type { ReportHandler } from '@/types/reports';
import type { DeviceComplianceState } from '@/types/devices';

const USER_TABLE_COLUMNS = [
  { key: 'user', label: 'User' },
  { key: 'count', label: 'Device Count' },
];

export const usersWithNonCompliantDevices: ReportHandler = async (tenantId) => {
  const token = await getServicePrincipalToken(tenantId);
  if (!token) throw new Error('Failed to get Graph API token');

  const { devices, partial } = await fetchFleetDevicesForReports(tenantId, token);

  const counts = new Map<string, number>();
  for (const device of devices) {
    if (!device.userPrincipalName) continue;
    if (!isNonCompliant((device.complianceState || 'unknown') as DeviceComplianceState)) continue;
    counts.set(device.userPrincipalName, (counts.get(device.userPrincipalName) ?? 0) + 1);
  }

  const rows = Array.from(counts.entries())
    .map(([user, count]) => ({ user, count }))
    .sort((a, b) => b.count - a.count);

  return { chartType: 'table', columns: USER_TABLE_COLUMNS, rows, generatedAt: new Date().toISOString(), partial };
};

export const usersWithPatchIssues: ReportHandler = async (tenantId) => {
  const token = await getServicePrincipalToken(tenantId);
  if (!token) throw new Error('Failed to get Graph API token');

  const [quality, fleet] = await Promise.all([
    listQualityUpdateCatalog(token),
    fetchFleetDevicesForReports(tenantId, token),
  ]);

  const counts = new Map<string, number>();
  for (const device of fleet.devices) {
    if (!device.userPrincipalName || device.operatingSystem !== 'Windows') continue;
    const status = computeDeviceQualityStatus(device.osVersion, quality);
    if (!status || status.missing.length === 0) continue;
    counts.set(device.userPrincipalName, (counts.get(device.userPrincipalName) ?? 0) + 1);
  }

  const rows = Array.from(counts.entries())
    .map(([user, count]) => ({ user, count }))
    .sort((a, b) => b.count - a.count);

  return { chartType: 'table', columns: USER_TABLE_COLUMNS, rows, generatedAt: new Date().toISOString(), partial: fleet.partial };
};

export const usersHandlers: Record<string, ReportHandler> = {
  'users-with-non-compliant-devices': usersWithNonCompliantDevices,
  'users-with-patch-issues': usersWithPatchIssues,
};
