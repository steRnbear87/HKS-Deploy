/**
 * Patching & OS report handlers - the most mature existing data domain.
 * Built entirely on lib/intune/windows-update-catalog.ts (Microsoft's
 * release catalog) + lib/intune/windows-update-compliance.ts (pure
 * client-safe per-device join logic, already used by ReleaseCatalogSection.tsx)
 * joined against a live fleet-device sweep - no new Graph integration.
 */

import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { listFeatureUpdateCatalog, listQualityUpdateCatalog } from '@/lib/intune/windows-update-catalog';
import {
  computeDeviceQualityStatus,
  computeDeviceFeatureStatus,
  buildFeatureVersionMap,
} from '@/lib/intune/windows-update-compliance';
import { fetchFleetDevicesForReports } from '@/lib/reports/fleet-devices';
import type { ReportHandler } from '@/types/reports';

async function loadContext(tenantId: string) {
  const token = await getServicePrincipalToken(tenantId);
  if (!token) throw new Error('Failed to get Graph API token');

  const [quality, feature, fleet] = await Promise.all([
    listQualityUpdateCatalog(token),
    listFeatureUpdateCatalog(token),
    fetchFleetDevicesForReports(tenantId, token),
  ]);

  return { quality, feature, ...fleet };
}

function windowsOnly<T extends { operatingSystem: string | null }>(devices: T[]): T[] {
  return devices.filter((d) => d.operatingSystem === 'Windows');
}

export const devicesBehindOnPatches: ReportHandler = async (tenantId) => {
  const { quality, devices, partial } = await loadContext(tenantId);

  const columns = [
    { key: 'device', label: 'Device' },
    { key: 'osVersion', label: 'OS Version' },
    { key: 'missingCount', label: 'Missing Updates' },
    { key: 'latestMissing', label: 'Latest Missing Update' },
  ];

  const tableRows: Array<Record<string, string | number | null>> = [];
  for (const device of windowsOnly(devices)) {
    const status = computeDeviceQualityStatus(device.osVersion, quality);
    if (!status || status.missing.length === 0) continue;
    tableRows.push({
      device: device.deviceName || 'Unknown device',
      osVersion: device.osVersion || 'Unknown',
      missingCount: status.missing.length,
      latestMissing: status.missing[0]?.displayName ?? 'Unknown',
    });
  }
  tableRows.sort((a, b) => (b.missingCount as number) - (a.missingCount as number));

  return { chartType: 'table', columns, rows: tableRows, generatedAt: new Date().toISOString(), partial };
};

export const outstandingPatchesByKb: ReportHandler = async (tenantId) => {
  const { quality, devices, partial } = await loadContext(tenantId);

  const countByRelease = new Map<string, number>();
  for (const device of windowsOnly(devices)) {
    const status = computeDeviceQualityStatus(device.osVersion, quality);
    if (!status) continue;
    for (const missingItem of status.missing) {
      const label = missingItem.kbArticleId ? `KB${missingItem.kbArticleId}` : missingItem.displayName;
      countByRelease.set(label, (countByRelease.get(label) ?? 0) + 1);
    }
  }

  const data = Array.from(countByRelease.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);

  return { chartType: 'bar', data, generatedAt: new Date().toISOString(), partial };
};

export const osHealth: ReportHandler = async (tenantId) => {
  const { quality, devices, partial } = await loadContext(tenantId);
  const windowsDevices = windowsOnly(devices);

  let fullyPatched = 0;
  let behind = 0;
  const distinctBuilds = new Set<string>();
  for (const device of windowsDevices) {
    if (device.osVersion) distinctBuilds.add(device.osVersion);
    const status = computeDeviceQualityStatus(device.osVersion, quality);
    if (!status) continue;
    if (status.missing.length === 0) fullyPatched++;
    else behind++;
  }

  const stats = [
    { label: 'Total Windows Devices', value: windowsDevices.length },
    { label: 'Fully Patched', value: fullyPatched },
    { label: 'Behind on Patches', value: behind },
    { label: 'Distinct OS Builds', value: distinctBuilds.size },
  ];

  return { chartType: 'stat-grid', stats, generatedAt: new Date().toISOString(), partial };
};

export const osSupportStatus: ReportHandler = async (tenantId) => {
  const { quality, feature, devices, partial } = await loadContext(tenantId);
  const versionBuildMap = buildFeatureVersionMap(quality);
  const now = Date.now();

  let supported = 0;
  let endOfService = 0;
  let unknown = 0;
  for (const device of windowsOnly(devices)) {
    const status = computeDeviceFeatureStatus(device.osVersion, feature, versionBuildMap);
    if (!status?.current) {
      unknown++;
      continue;
    }
    if (status.current.endOfSupportDate && new Date(status.current.endOfSupportDate).getTime() < now) {
      endOfService++;
    } else {
      supported++;
    }
  }

  const data = [
    { label: 'Supported', value: supported },
    { label: 'End of Service', value: endOfService },
    { label: 'Unknown', value: unknown },
  ].filter((d) => d.value > 0);

  return { chartType: 'pie', data, generatedAt: new Date().toISOString(), partial };
};

export const patches: ReportHandler = async (tenantId) => {
  const { quality, devices, partial } = await loadContext(tenantId);

  const columns = [
    { key: 'device', label: 'Device' },
    { key: 'osVersion', label: 'OS Version' },
    { key: 'installed', label: 'Installed' },
    { key: 'missing', label: 'Missing' },
  ];

  const rows: Array<Record<string, string | number | null>> = windowsOnly(devices).map((device) => {
    const status = computeDeviceQualityStatus(device.osVersion, quality);
    return {
      device: device.deviceName || 'Unknown device',
      osVersion: device.osVersion || 'Unknown',
      installed: status?.installed.length ?? 0,
      missing: status?.missing.length ?? 0,
    };
  });
  rows.sort((a, b) => (b.missing as number) - (a.missing as number));

  return { chartType: 'table', columns, rows, generatedAt: new Date().toISOString(), partial };
};

export const patchingHandlers: Record<string, ReportHandler> = {
  'devices-behind-on-patches': devicesBehindOnPatches,
  'outstanding-patches-by-kb': outstandingPatchesByKb,
  'os-health': osHealth,
  'os-support-status': osSupportStatus,
  patches,
};
