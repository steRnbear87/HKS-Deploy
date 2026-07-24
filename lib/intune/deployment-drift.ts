/**
 * Deployment drift detection.
 *
 * Cross-references what IntuneGet believes it deployed (an already-detected
 * update's currentVersion, i.e. what the Intune app object itself reports)
 * against what devices actually report installed via Graph's detectedApps
 * telemetry, so a rollout that's silently stuck or partially rolled back
 * becomes visible per-app instead of assumed. Cron-only (see
 * app/api/cron/check-updates/route.ts) - the tenant-wide sweep + per-app
 * fan-out this requires is too slow for the interactive Refresh button.
 *
 * Two-hop Graph pattern, same one already proven in
 * app/api/intune/detected-app-devices/route.ts:
 *   1. One tenant-wide deviceManagement/detectedApps sweep resolves which
 *      detected-app ids (one per app+version combination) exist for a given
 *      managed app's display name.
 *   2. detectedApps/{id}/managedDevices is fanned out only for those specific
 *      ids - bounded by the number of managed apps and the versions Graph has
 *      actually observed for each, not by fleet size.
 */

import {
  GRAPH_API_BASE,
  fetchWithRetry,
  invalidateServicePrincipalToken,
} from '@/lib/intune/graph-client';
import { normalizeAppKey } from '@/lib/intune/device-health';
import { compareVersions, normalizeVersion } from '@/lib/version-compare';
import type { AppUpdateInfo } from '@/types/inventory';

// detectedApps (the tenant-wide list) requires beta - same as the fleet
// app-inventory snapshot job and the per-device detected-apps route.
const GRAPH_API_BASE_BETA = 'https://graph.microsoft.com/beta';

const SWEEP_SCAN_BUDGET_MS = 40_000;
// Per-app fan-out budget, separate from the sweep above - bounds the total
// time spent across every managed app's managedDevices calls in one run.
const FANOUT_SCAN_BUDGET_MS = 60_000;
// Versions fanned out per app. Realistically 1-3 in the wild; this guards
// pathological churn the same way detected-app-devices/route.ts does.
const MAX_VERSIONS_PER_APP = 25;
const CONCURRENCY = 4;

class ScanBudgetExceededError extends Error {
  constructor() {
    super('Deployment drift scan budget exhausted');
    this.name = 'ScanBudgetExceededError';
  }
}

interface RawDetectedApp {
  id: string;
  displayName: string;
  version: string | null;
  deviceCount: number;
}

export interface DetectedAppVersionGroup {
  version: string;
  detectedAppId: string;
  /** Graph's own aggregate hint for this version - not authoritative; the
   * managedDevices fan-out count is what actually gets persisted. */
  deviceCountHint: number;
}

export interface TenantDetectedAppsIndex {
  byAppKey: Map<string, DetectedAppVersionGroup[]>;
}

/**
 * One paginated sweep of the tenant-wide detectedApps collection, grouped by
 * normalized display name. Same Graph call lib/device-health/app-inventory-
 * snapshot.ts already makes for the "Top Installed Apps" widget, just also
 * selecting `id` (needed for the managedDevices fan-out) and keeping each
 * version separate instead of collapsing them.
 */
export async function fetchTenantDetectedAppsIndex(
  tenantId: string,
  graphToken: string
): Promise<TenantDetectedAppsIndex> {
  const byAppKey = new Map<string, DetectedAppVersionGroup[]>();
  const scanDeadline = Date.now() + SWEEP_SCAN_BUDGET_MS;

  let nextUrl: string | null =
    `${GRAPH_API_BASE_BETA}/deviceManagement/detectedApps?$select=id,displayName,version,deviceCount`;

  while (nextUrl) {
    if (Date.now() >= scanDeadline) break;

    const response: Response = await fetchWithRetry(
      nextUrl,
      {
        headers: {
          Authorization: `Bearer ${graphToken}`,
          'Content-Type': 'application/json',
        },
      },
      3,
      scanDeadline
    );

    if (!response.ok) {
      if (response.status === 401) {
        invalidateServicePrincipalToken(tenantId);
      }
      const bodyText = await response.text().catch(() => '');
      console.error(`[deployment-drift] Graph detectedApps ${response.status} for tenant ${tenantId}:`, bodyText);
      break;
    }

    const data: { value?: RawDetectedApp[]; '@odata.nextLink'?: string } = await response.json();
    for (const app of data.value ?? []) {
      if (!app.version) continue;
      const key = normalizeAppKey(app.displayName);
      const group = byAppKey.get(key) ?? [];
      group.push({ version: app.version, detectedAppId: app.id, deviceCountHint: app.deviceCount });
      byAppKey.set(key, group);
    }

    nextUrl = data['@odata.nextLink'] ?? null;
  }

  return { byAppKey };
}

export interface DriftResult {
  wingetId: string;
  intuneAppId: string;
  displayName: string;
  expectedVersion: string;
  totalDevicesScanned: number;
  onExpectedCount: number;
  behindCount: number;
  aheadCount: number;
  partial: boolean;
}

/** Count of managedDevices for one detected-app version id, following pagination. */
async function countDevicesForDetectedApp(
  detectedAppId: string,
  token: string,
  tenantId: string,
  deadlineAt: number
): Promise<number> {
  let count = 0;
  let nextUrl: string | null =
    `${GRAPH_API_BASE}/deviceManagement/detectedApps/${encodeURIComponent(detectedAppId)}/managedDevices?$select=id`;

  while (nextUrl) {
    if (Date.now() >= deadlineAt) {
      throw new ScanBudgetExceededError();
    }

    const response = await fetchWithRetry(
      nextUrl,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
      3,
      deadlineAt
    );

    if (!response.ok) {
      if (response.status === 401) {
        invalidateServicePrincipalToken(tenantId);
      }
      // Stale/removed version id - treat as no devices rather than failing
      // the whole app's drift computation.
      if (response.status === 404) {
        await response.text().catch(() => {});
        return count;
      }
      const bodyText = await response.text().catch(() => '');
      throw new Error(`Graph managedDevices ${response.status} for detectedApp ${detectedAppId}: ${bodyText}`);
    }

    const data: { value?: Array<{ id: string }>; '@odata.nextLink'?: string } = await response.json();
    count += data.value?.length ?? 0;
    nextUrl = data['@odata.nextLink'] ?? null;
  }

  return count;
}

/**
 * Computes rollout/drift status for a tenant's currently-managed updates
 * (caller must pre-filter to isManaged === true - unmanaged/fuzzy matches
 * don't have a trustworthy "expected version" to compare against). Apps with
 * no telemetry match in the index (nothing scanned yet, or display name
 * doesn't match) are skipped, not reported as zero-drift.
 */
export async function computeDeploymentDriftForUpdates(
  managedUpdates: AppUpdateInfo[],
  detectedAppsIndex: TenantDetectedAppsIndex,
  tenantId: string,
  graphToken: string
): Promise<DriftResult[]> {
  const results: DriftResult[] = [];
  const fanoutDeadline = Date.now() + FANOUT_SCAN_BUDGET_MS;

  for (const update of managedUpdates) {
    if (!update.wingetId) continue;
    if (Date.now() >= fanoutDeadline) break;

    const appKey = normalizeAppKey(update.intuneApp.displayName);
    const versionGroups = detectedAppsIndex.byAppKey.get(appKey);
    if (!versionGroups || versionGroups.length === 0) continue;

    const truncated = versionGroups.length > MAX_VERSIONS_PER_APP;
    const groupsToScan = truncated ? versionGroups.slice(0, MAX_VERSIONS_PER_APP) : versionGroups;
    const expectedVersion = normalizeVersion(update.currentVersion);

    let onExpectedCount = 0;
    let behindCount = 0;
    let aheadCount = 0;
    let partial = truncated;

    try {
      for (let i = 0; i < groupsToScan.length; i += CONCURRENCY) {
        if (Date.now() >= fanoutDeadline) {
          partial = true;
          break;
        }
        const chunk = groupsToScan.slice(i, i + CONCURRENCY);
        const chunkCounts = await Promise.all(
          chunk.map((group) => countDevicesForDetectedApp(group.detectedAppId, graphToken, tenantId, fanoutDeadline))
        );
        chunk.forEach((group, idx) => {
          const count = chunkCounts[idx];
          const comparison = compareVersions(normalizeVersion(group.version), expectedVersion);
          if (comparison === 0) onExpectedCount += count;
          else if (comparison < 0) behindCount += count;
          else aheadCount += count;
        });
      }
    } catch (error) {
      if (error instanceof ScanBudgetExceededError) {
        partial = true;
      } else {
        console.error(
          `[deployment-drift] Failed scanning ${update.intuneApp.displayName} for tenant ${tenantId}:`,
          error
        );
        continue;
      }
    }

    const totalDevicesScanned = onExpectedCount + behindCount + aheadCount;
    if (totalDevicesScanned === 0) continue;

    results.push({
      wingetId: update.wingetId,
      intuneAppId: update.intuneApp.id,
      displayName: update.intuneApp.displayName,
      expectedVersion: update.currentVersion,
      totalDevicesScanned,
      onExpectedCount,
      behindCount,
      aheadCount,
      partial,
    });
  }

  return results;
}
