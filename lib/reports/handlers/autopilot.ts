/**
 * Autopilot report handlers - read the autopilot_device_snapshots cache
 * (lib/intune-reports/autopilot.ts) rather than calling Graph live, same
 * pattern as the existing /api/intune/reports/autopilot route. "By OS
 * Version" is the one query-time join: the snapshot itself has no OS version
 * (windowsAutopilotDeviceIdentities doesn't carry it), so it's matched
 * against a live fleet-device sweep by serial number.
 *
 * The other 5 Autopilot reports (Enrollment Method, By Profile, ESP Device/
 * User Setup Failures, Slow Deployments) stay 'coming-soon' in the registry -
 * none of their fields exist on this Graph resource.
 */

import { getDatabase } from '@/lib/db';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { fetchFleetDevicesForReports } from '@/lib/reports/fleet-devices';
import type { ReportHandler } from '@/types/reports';
import type { AutopilotDeviceSnapshotRecord } from '@/lib/db/types';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function identify(row: AutopilotDeviceSnapshotRecord): string {
  return [row.manufacturer, row.model].filter(Boolean).join(' ') || row.serial_number || 'Unknown device';
}

export const autopilotDeploymentStatus: ReportHandler = async (tenantId) => {
  const rows = await getDatabase().autopilotDeviceSnapshots.getByTenantId(tenantId);

  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = row.deployment_profile_assignment_status || 'unknown';
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  const data = Array.from(counts.entries()).map(([label, value]) => ({ label, value }));
  return { chartType: 'pie', data, generatedAt: new Date().toISOString() };
};

export const autopilotDeploymentsByOsVersion: ReportHandler = async (tenantId) => {
  const [snapshotRows, token] = await Promise.all([
    getDatabase().autopilotDeviceSnapshots.getByTenantId(tenantId),
    getServicePrincipalToken(tenantId),
  ]);
  if (!token) throw new Error('Failed to get Graph API token');

  const { devices, partial } = await fetchFleetDevicesForReports(tenantId, token);
  const osVersionBySerial = new Map(
    devices.filter((d) => d.serialNumber).map((d) => [d.serialNumber as string, d.osVersion])
  );

  const counts = new Map<string, number>();
  for (const row of snapshotRows) {
    if (!row.serial_number) continue;
    const osVersion = osVersionBySerial.get(row.serial_number);
    if (!osVersion) continue;
    counts.set(osVersion, (counts.get(osVersion) ?? 0) + 1);
  }

  const data = Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  return { chartType: 'bar', data, generatedAt: new Date().toISOString(), partial };
};

const AUTOPILOT_TABLE_COLUMNS = [
  { key: 'device', label: 'Device' },
  { key: 'enrollmentState', label: 'Enrollment State' },
  { key: 'deploymentStatus', label: 'Deployment Status' },
  { key: 'lastContacted', label: 'Last Contacted' },
];

function toAutopilotRow(row: AutopilotDeviceSnapshotRecord): Record<string, string | number | null> {
  return {
    device: identify(row),
    enrollmentState: row.enrollment_state,
    deploymentStatus: row.deployment_profile_assignment_status,
    lastContacted: row.last_contacted_at ? new Date(row.last_contacted_at).toLocaleString() : 'Never',
  };
}

export const failedAutopilotDeployments: ReportHandler = async (tenantId) => {
  const rows = await getDatabase().autopilotDeviceSnapshots.getByTenantId(tenantId);
  const failed = rows.filter(
    (r) => r.enrollment_state === 'failed' || r.deployment_profile_assignment_status === 'failed'
  );
  return {
    chartType: 'table',
    columns: AUTOPILOT_TABLE_COLUMNS,
    rows: failed.map(toAutopilotRow),
    generatedAt: new Date().toISOString(),
  };
};

export const recentAutopilotDeployments: ReportHandler = async (tenantId) => {
  const rows = await getDatabase().autopilotDeviceSnapshots.getByTenantId(tenantId);
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const recent = rows.filter((r) => r.last_contacted_at && new Date(r.last_contacted_at).getTime() >= cutoff);
  return {
    chartType: 'table',
    columns: AUTOPILOT_TABLE_COLUMNS,
    rows: recent
      .sort((a, b) => (b.last_contacted_at || '').localeCompare(a.last_contacted_at || ''))
      .map(toAutopilotRow),
    generatedAt: new Date().toISOString(),
  };
};

export const autopilotHandlers: Record<string, ReportHandler> = {
  'autopilot-deployment-status': autopilotDeploymentStatus,
  'autopilot-deployments-by-os-version': autopilotDeploymentsByOsVersion,
  'failed-autopilot-deployments': failedAutopilotDeployments,
  'recent-autopilot-deployments': recentAutopilotDeployments,
};
