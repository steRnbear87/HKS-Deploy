/**
 * Fleet-wide "top installed apps" snapshot capture.
 *
 * Confirmed empirically that Graph beta exposes a TENANT-WIDE
 * `deviceManagement/detectedApps` collection with a real, populated
 * `deviceCount` field (12,094 rows observed for this tenant) - this means the
 * ranking is one paginated sweep, the same cost profile as the device-health
 * snapshot, NOT a per-device fan-out. Each row in the raw collection is one
 * app+version combination; multiple versions of the same app are grouped
 * under a normalized `app_key` and their device counts summed.
 */

import { getDatabase } from '@/lib/db';
import { fetchWithRetry, getServicePrincipalToken, invalidateServicePrincipalToken } from '@/lib/intune/graph-client';
import { normalizeAppKey } from '@/lib/intune/device-health';

// detectedApps requires beta - same as the per-device detected-apps route.
const GRAPH_API_BASE_BETA = 'https://graph.microsoft.com/beta';

const SCAN_BUDGET_MS = 40_000;
const TOP_N_PERSISTED = 100;
const RETENTION_DAYS = 60;

interface RawDetectedApp {
  displayName: string;
  publisher: string | null;
  deviceCount: number;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function captureAppInventorySnapshot(tenantId: string): Promise<void> {
  const token = await getServicePrincipalToken(tenantId);
  if (!token) {
    console.error(`[app-inventory] Failed to get Graph token for tenant ${tenantId}, skipping snapshot`);
    return;
  }

  const scanDeadline = Date.now() + SCAN_BUDGET_MS;
  const counts = new Map<string, { displayName: string; publisher: string | null; deviceCount: number }>();
  let partial = false;

  // Reuse the real total from the device-health snapshot job (runs just
  // before this one, same instrumentation.ts tick) rather than guessing -
  // detectedApps has no tenant-wide device-count field of its own.
  const healthSnapshot = await getDatabase().deviceHealthSnapshots.getLatest(tenantId);
  const devicesTotal = healthSnapshot?.total_devices ?? 0;

  let nextUrl: string | null =
    `${GRAPH_API_BASE_BETA}/deviceManagement/detectedApps?$select=displayName,publisher,deviceCount`;

  try {
    while (nextUrl) {
      if (Date.now() >= scanDeadline) {
        partial = true;
        break;
      }

      const response = await fetchWithRetry(
        nextUrl,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
        3,
        scanDeadline
      );

      if (!response.ok) {
        if (response.status === 401) invalidateServicePrincipalToken(tenantId);
        const bodyText = await response.text().catch(() => '');
        console.error(`[app-inventory] Graph detectedApps ${response.status} for tenant ${tenantId}:`, bodyText);
        return;
      }

      const data: { value?: RawDetectedApp[]; '@odata.nextLink'?: string } = await response.json();

      for (const app of data.value ?? []) {
        const key = normalizeAppKey(app.displayName);
        const existing = counts.get(key);
        if (existing) {
          existing.deviceCount += app.deviceCount;
        } else {
          counts.set(key, { displayName: app.displayName, publisher: app.publisher, deviceCount: app.deviceCount });
        }
      }

      nextUrl = data['@odata.nextLink'] ?? null;
    }
  } catch (error) {
    console.error(`[app-inventory] Snapshot scan failed for tenant ${tenantId}:`, error);
    if (counts.size === 0) return;
    partial = true;
  }

  const topApps = Array.from(counts.values())
    .sort((a, b) => b.deviceCount - a.deviceCount)
    .slice(0, TOP_N_PERSISTED);

  const capturedAt = new Date().toISOString();

  await getDatabase().fleetAppInventory.replaceForDate(
    tenantId,
    todayUTC(),
    topApps.map((app) => ({
      captured_at: capturedAt,
      app_key: normalizeAppKey(app.displayName),
      display_name: app.displayName,
      publisher: app.publisher,
      device_count: app.deviceCount,
      devices_total: devicesTotal,
      partial,
    }))
  );
}

/** Snapshot every known tenant that hasn't been captured yet today. */
export async function captureDueAppInventorySnapshots(): Promise<void> {
  const db = getDatabase();
  const tenantIds = await db.deviceHealthSnapshots.getKnownTenantIds();
  const today = todayUTC();

  for (const tenantId of tenantIds) {
    try {
      const latest = await db.fleetAppInventory.getLatestForTenant(tenantId, 1);
      if (latest[0]?.snapshot_date === today) continue;
      await captureAppInventorySnapshot(tenantId);
    } catch (error) {
      console.error(`[app-inventory] Failed to snapshot tenant ${tenantId}:`, error);
    }
  }

  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db.fleetAppInventory.deleteOlderThan(cutoff);
  } catch (error) {
    console.error('[app-inventory] Failed to prune old snapshots:', error);
  }
}
