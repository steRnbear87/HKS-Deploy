/**
 * Security report handlers. Encryption Status reuses the existing
 * summarizeDeviceEncryption() rollup (lib/intune/device-health.ts) - the
 * other 3 Security reports eido has are unnamed and not in the registry yet.
 */

import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { summarizeDeviceEncryption } from '@/lib/intune/device-health';
import { fetchFleetDevicesForReports } from '@/lib/reports/fleet-devices';
import type { ReportHandler } from '@/types/reports';

export const encryptionStatus: ReportHandler = async (tenantId) => {
  const token = await getServicePrincipalToken(tenantId);
  if (!token) throw new Error('Failed to get Graph API token');

  const { devices, partial } = await fetchFleetDevicesForReports(tenantId, token);
  const counts = summarizeDeviceEncryption(
    devices.filter((d): d is typeof d & { operatingSystem: string } => d.operatingSystem !== null)
  );

  const data = [
    { label: 'Encrypted', value: counts.windowsEncrypted + counts.macEncrypted },
    { label: 'Unencrypted', value: counts.windowsUnencrypted + counts.macUnencrypted },
    { label: 'Unknown', value: counts.windowsUnknown + counts.macUnknown },
  ].filter((d) => d.value > 0);

  return { chartType: 'pie', data, generatedAt: new Date().toISOString(), partial };
};

export const securityHandlers: Record<string, ReportHandler> = {
  'encryption-status': encryptionStatus,
};
