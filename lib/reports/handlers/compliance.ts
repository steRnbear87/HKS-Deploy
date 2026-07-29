/**
 * Compliance report handlers - built on a live fleet-device sweep
 * (lib/reports/fleet-devices.ts) plus the existing isNonCompliant/isStale
 * bucketing from lib/intune/device-health.ts. No new Graph calls.
 */

import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { isNonCompliant, isStale } from '@/lib/intune/device-health';
import { fetchFleetDevicesForReports, type ReportFleetDevice } from '@/lib/reports/fleet-devices';
import type { ReportHandler } from '@/types/reports';
import type { DeviceComplianceState } from '@/types/devices';

async function loadDevices(tenantId: string) {
  const token = await getServicePrincipalToken(tenantId);
  if (!token) throw new Error('Failed to get Graph API token');
  return fetchFleetDevicesForReports(tenantId, token);
}

const DEVICE_TABLE_COLUMNS = [
  { key: 'device', label: 'Device' },
  { key: 'complianceState', label: 'Compliance State' },
  { key: 'ownership', label: 'Ownership' },
  { key: 'lastCheckIn', label: 'Last Check-in' },
];

function toRow(device: ReportFleetDevice): Record<string, string | number | null> {
  return {
    device: device.deviceName || 'Unknown device',
    complianceState: device.complianceState || 'unknown',
    ownership: device.managedDeviceOwnerType === 'company' ? 'Corporate' : device.managedDeviceOwnerType === 'personal' ? 'BYOD' : 'Unknown',
    lastCheckIn: device.lastSyncDateTime ? new Date(device.lastSyncDateTime).toLocaleString() : 'Never',
  };
}

export const complianceStatusBreakdown: ReportHandler = async (tenantId) => {
  const { devices, partial } = await loadDevices(tenantId);

  const counts = new Map<DeviceComplianceState, number>();
  for (const device of devices) {
    const state = (device.complianceState || 'unknown') as DeviceComplianceState;
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }

  const data = Array.from(counts.entries()).map(([label, value]) => ({ label, value }));
  return { chartType: 'pie', data, generatedAt: new Date().toISOString(), partial };
};

// "High severity" isn't a real Intune field - approximated as devices that
// are both out of compliance AND haven't checked in recently, since IT can't
// rely on auto-remediation reaching a device that isn't phoning home.
export const highSeverityComplianceDevices: ReportHandler = async (tenantId) => {
  const { devices, partial } = await loadDevices(tenantId);

  const rows = devices
    .filter(
      (d) =>
        isNonCompliant((d.complianceState || 'unknown') as DeviceComplianceState) &&
        (!d.lastSyncDateTime || isStale(d.lastSyncDateTime))
    )
    .map(toRow);

  return { chartType: 'table', columns: DEVICE_TABLE_COLUMNS, rows, generatedAt: new Date().toISOString(), partial };
};

export const nonCompliantByodDevices: ReportHandler = async (tenantId) => {
  const { devices, partial } = await loadDevices(tenantId);
  const rows = devices
    .filter((d) => isNonCompliant((d.complianceState || 'unknown') as DeviceComplianceState) && d.managedDeviceOwnerType === 'personal')
    .map(toRow);
  return { chartType: 'table', columns: DEVICE_TABLE_COLUMNS, rows, generatedAt: new Date().toISOString(), partial };
};

export const nonCompliantCorporateDevices: ReportHandler = async (tenantId) => {
  const { devices, partial } = await loadDevices(tenantId);
  const rows = devices
    .filter((d) => isNonCompliant((d.complianceState || 'unknown') as DeviceComplianceState) && d.managedDeviceOwnerType === 'company')
    .map(toRow);
  return { chartType: 'table', columns: DEVICE_TABLE_COLUMNS, rows, generatedAt: new Date().toISOString(), partial };
};

export const nonCompliantDevices: ReportHandler = async (tenantId) => {
  const { devices, partial } = await loadDevices(tenantId);
  const rows = devices
    .filter((d) => isNonCompliant((d.complianceState || 'unknown') as DeviceComplianceState))
    .map(toRow);
  return { chartType: 'table', columns: DEVICE_TABLE_COLUMNS, rows, generatedAt: new Date().toISOString(), partial };
};

export const complianceHandlers: Record<string, ReportHandler> = {
  'compliance-status-breakdown': complianceStatusBreakdown,
  'high-severity-compliance-devices': highSeverityComplianceDevices,
  'non-compliant-byod-devices': nonCompliantByodDevices,
  'non-compliant-corporate-devices': nonCompliantCorporateDevices,
  'non-compliant-devices': nonCompliantDevices,
};
