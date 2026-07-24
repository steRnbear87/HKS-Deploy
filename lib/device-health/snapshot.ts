/**
 * Fleet-health snapshot capture. Microsoft Graph has no historical device
 * compliance data - this module builds that history ourselves by paging the
 * live device list once and rolling it up into one row per tenant per day.
 */

import { getDatabase } from '@/lib/db';
import { GRAPH_API_BASE, fetchWithRetry, getServicePrincipalToken } from '@/lib/intune/graph-client';
import { summarizeDeviceHealth } from '@/lib/intune/device-health';
import type { ManagedDevice } from '@/types/devices';

// Same budget as the live devices list route - a handful of paginated
// requests for ~2,500 devices comfortably fits well inside this.
const SCAN_BUDGET_MS = 40_000;

// Trend chart never needs more than this; trivial storage cost either way.
const RETENTION_DAYS = 180;

const SNAPSHOT_SELECT = 'complianceState,lastSyncDateTime';

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function captureDeviceHealthSnapshot(tenantId: string): Promise<void> {
  const token = await getServicePrincipalToken(tenantId);
  if (!token) {
    console.error(`[device-health] Failed to get Graph token for tenant ${tenantId}, skipping snapshot`);
    return;
  }

  const scanDeadline = Date.now() + SCAN_BUDGET_MS;
  const deviceStates: Pick<ManagedDevice, 'complianceState' | 'lastSyncDateTime'>[] = [];
  let partial = false;

  let nextUrl: string | null = `${GRAPH_API_BASE}/deviceManagement/managedDevices?$select=${SNAPSHOT_SELECT}`;

  try {
    while (nextUrl) {
      if (Date.now() >= scanDeadline) {
        partial = true;
        break;
      }

      const response: Response = await fetchWithRetry(
        nextUrl,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
        3,
        scanDeadline
      );

      if (!response.ok) {
        console.error(`[device-health] Graph managedDevices ${response.status} for tenant ${tenantId}`);
        return;
      }

      const data: {
        value?: Pick<ManagedDevice, 'complianceState' | 'lastSyncDateTime'>[];
        '@odata.nextLink'?: string;
      } = await response.json();

      if (Array.isArray(data.value)) {
        deviceStates.push(...data.value);
      }
      nextUrl = data['@odata.nextLink'] || null;
    }
  } catch (error) {
    console.error(`[device-health] Snapshot scan failed for tenant ${tenantId}:`, error);
    if (deviceStates.length === 0) return;
    partial = true;
  }

  const counts = summarizeDeviceHealth(deviceStates);

  await getDatabase().deviceHealthSnapshots.upsert({
    tenant_id: tenantId,
    snapshot_date: todayUTC(),
    captured_at: new Date().toISOString(),
    total_devices: counts.total,
    compliant_count: counts.compliant,
    noncompliant_count: counts.nonCompliant,
    in_grace_period_count: counts.inGracePeriod,
    config_manager_count: counts.configManager,
    unknown_count: counts.unknown,
    stale_count: counts.stale,
    partial,
  });
}

/** Snapshot every known tenant that hasn't been captured yet today. */
export async function captureDueDeviceHealthSnapshots(): Promise<void> {
  const db = getDatabase();
  const tenantIds = await db.deviceHealthSnapshots.getKnownTenantIds();
  const today = todayUTC();

  for (const tenantId of tenantIds) {
    try {
      const latest = await db.deviceHealthSnapshots.getLatest(tenantId);
      if (latest?.snapshot_date === today) continue;
      await captureDeviceHealthSnapshot(tenantId);
    } catch (error) {
      console.error(`[device-health] Failed to snapshot tenant ${tenantId}:`, error);
    }
  }

  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db.deviceHealthSnapshots.deleteOlderThan(cutoff);
  } catch (error) {
    console.error('[device-health] Failed to prune old snapshots:', error);
  }
}
