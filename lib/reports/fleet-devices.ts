/**
 * Shared live fleet-device fetch for report handlers. Several report
 * handlers (Patching & OS, Compliance, Device Health, Users) each need a
 * subset of the same managedDevices fields, and there's no bulk cache for
 * them (unlike BIOS/Autopilot) - one paginated live Graph sweep here, reused
 * by every handler that needs it, instead of each re-implementing pagination.
 */

import { GRAPH_API_BASE, fetchWithRetry, invalidateServicePrincipalToken } from '@/lib/intune/graph-client';

export interface ReportFleetDevice {
  id: string;
  deviceName: string | null;
  operatingSystem: string | null;
  osVersion: string | null;
  complianceState: string | null;
  managedDeviceOwnerType: string | null;
  userPrincipalName: string | null;
  lastSyncDateTime: string | null;
  serialNumber: string | null;
  isEncrypted: boolean | null;
}

const FLEET_DEVICE_SELECT =
  'id,deviceName,operatingSystem,osVersion,complianceState,managedDeviceOwnerType,userPrincipalName,lastSyncDateTime,serialNumber,isEncrypted';

const SCAN_BUDGET_MS = 40_000;

export async function fetchFleetDevicesForReports(
  tenantId: string,
  token: string
): Promise<{ devices: ReportFleetDevice[]; partial: boolean }> {
  const devices: ReportFleetDevice[] = [];
  let partial = false;
  const deadline = Date.now() + SCAN_BUDGET_MS;
  let nextUrl: string | null = `${GRAPH_API_BASE}/deviceManagement/managedDevices?$select=${FLEET_DEVICE_SELECT}`;

  while (nextUrl) {
    if (Date.now() >= deadline) {
      partial = true;
      break;
    }

    const response = await fetchWithRetry(
      nextUrl,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
      3,
      deadline
    );

    if (!response.ok) {
      if (response.status === 401) invalidateServicePrincipalToken(tenantId);
      partial = true;
      break;
    }

    const data: { value?: ReportFleetDevice[]; '@odata.nextLink'?: string } = await response.json();
    if (Array.isArray(data.value)) devices.push(...data.value);
    nextUrl = data['@odata.nextLink'] ?? null;
  }

  return { devices, partial };
}
