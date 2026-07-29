/**
 * Live Intune app-inventory update detection.
 *
 * Extracted from app/api/intune/apps/updates/route.ts so the same matching +
 * version-comparison logic can run both on-demand (that route, and
 * app/api/updates/refresh) and from the daily cron
 * (app/api/cron/check-updates) without duplicating it.
 *
 * Split into two steps because the Graph app inventory and everything that
 * doesn't depend on a specific user (description-marker matches, claimed_apps,
 * manual_app_mappings, fuzzy matching) is identical for every user of a
 * tenant - fetchTenantAppInventory() does that once; computeUserAppUpdates()
 * layers one user's own upload_history provenance on top and produces that
 * user's AppUpdateInfo[]. The catalog version lookup happens in the latter,
 * not the former: which winget_ids need a latest_version depends on the
 * user's own upload_history matches too, not just the tenant-level ones.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isValidWingetId,
  matchAppToWinget,
  matchAppToWingetWithDatabase,
} from '@/lib/app-matching';
import { compareVersions, hasUpdate, normalizeVersion } from '@/lib/version-compare';
import { fetchWithRetry, invalidateServicePrincipalToken } from '@/lib/intune/graph-client';
import { isSelfUpdatingApp } from '@/lib/self-updating-apps';
import { getCatalogSource } from '@/lib/catalog';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getDatabase } from '@/lib/db';
import type { IntuneWin32App, AppUpdateInfo } from '@/types/inventory';

const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

/** Thrown by fetchTenantAppInventory on a Graph failure, carrying the original status/details. */
export class GraphInventoryError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details: string
  ) {
    super(message);
    this.name = 'GraphInventoryError';
  }
}

export interface CheckedResult {
  app: string;
  wingetId: string | null;
  result: string;
}

interface TenantMatch {
  wingetId: string;
  // True for explicit provenance (description marker, claimed/manual mapping);
  // false for fuzzy name matches. upload_history provenance is layered on top
  // per-user in computeUserAppUpdates and always wins over this.
  isManaged: boolean;
}

export interface TenantAppInventory {
  apps: IntuneWin32App[];
  tenantMatches: Map<string /* intune_app_id */, TenantMatch>;
}

interface CuratedPackageRow {
  winget_id: string;
  latest_version: string | null;
}

interface ClaimedAppMappingRow {
  intune_app_id: string | null;
  discovered_app_name: string;
  winget_package_id: string;
}

interface ManualAppMappingRow {
  discovered_app_name: string;
  winget_package_id: string;
}

function extractWingetIdFromDescription(description: string | null): string | null {
  if (!description) {
    return null;
  }

  const match = description.match(
    /Winget:\s*([A-Za-z0-9]+\.[A-Za-z0-9]+(?:\.[A-Za-z0-9-]+)*)/i
  );

  if (!match) {
    return null;
  }

  const candidate = match[1].trim();
  return isValidWingetId(candidate) ? candidate : null;
}

// matchAppToWingetWithDatabase's supabase param is vestigial - its actual
// catalog lookup (searchCuratedApps) already routes through
// getCatalogSource(), which is itself DB-mode-aware (Supabase or the local
// SQLite snapshot). This stub only exists to satisfy the parameter's type
// when no real Supabase client is available (self-hosted mode); it is never
// actually queried.
const UNUSED_SUPABASE_STUB = { from: () => { throw new Error('Not available in self-hosted mode'); } };

/**
 * Pages the tenant's full Win32 app list once and resolves everything that's
 * the same for every user of the tenant: description-marker matches,
 * claimed_apps/manual_app_mappings links, fuzzy matches, and catalog latest
 * versions for every matched winget_id. `supabase` is null in self-hosted
 * mode - claimed_apps/manual_app_mappings are Supabase-only features with no
 * SQLite equivalent (out of scope, same as Discovered Apps claiming
 * elsewhere), so those links are simply unavailable there; description-marker
 * and fuzzy matching still work fully.
 */
export async function fetchTenantAppInventory(
  supabase: SupabaseClient | null,
  tenantId: string,
  graphToken: string
): Promise<TenantAppInventory> {
  const apps: IntuneWin32App[] = [];
  let nextUrl: string | null =
    `${GRAPH_API_BASE}/deviceAppManagement/mobileApps?$filter=isof('microsoft.graph.win32LobApp')&$top=100`;

  while (nextUrl) {
    const graphResponse: Response = await fetchWithRetry(nextUrl, {
      headers: {
        Authorization: `Bearer ${graphToken}`,
        'Content-Type': 'application/json',
      },
    }, 3);

    if (!graphResponse.ok) {
      if (graphResponse.status === 401) {
        invalidateServicePrincipalToken(tenantId);
      }
      const errorText = await graphResponse.text().catch(() => '');
      throw new GraphInventoryError('Failed to fetch apps from Intune', graphResponse.status, errorText);
    }

    const graphData = await graphResponse.json();
    const pageApps: IntuneWin32App[] = graphData.value || [];
    apps.push(...pageApps);

    nextUrl = graphData['@odata.nextLink'] || null;
  }

  const claimedWingetByIntuneAppId = new Map<string, string>();
  const claimedWingetByName = new Map<string, string>();
  const manualWingetByName = new Map<string, string>();

  // claimed_apps/manual_app_mappings are Supabase-only (Discovered Apps
  // claiming has no SQLite equivalent, same precedent as app/api/intune/claim)
  // - skip both lookups entirely in self-hosted mode rather than erroring.
  if (supabase) {
    const { data: claimedRows } = await supabase
      .from('claimed_apps')
      .select('intune_app_id, discovered_app_name, winget_package_id')
      .eq('tenant_id', tenantId);

    if (claimedRows) {
      for (const row of claimedRows as ClaimedAppMappingRow[]) {
        if (!row.winget_package_id) {
          continue;
        }
        if (row.intune_app_id) {
          claimedWingetByIntuneAppId.set(row.intune_app_id, row.winget_package_id);
        }
        if (row.discovered_app_name) {
          claimedWingetByName.set(row.discovered_app_name.toLowerCase().trim(), row.winget_package_id);
        }
      }
    }

    const { data: manualMappingRows } = await supabase
      .from('manual_app_mappings')
      .select('discovered_app_name, winget_package_id')
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`);

    if (manualMappingRows) {
      for (const row of manualMappingRows as ManualAppMappingRow[]) {
        if (row.discovered_app_name && row.winget_package_id) {
          manualWingetByName.set(row.discovered_app_name.toLowerCase().trim(), row.winget_package_id);
        }
      }
    }
  }

  const tenantMatches = new Map<string, TenantMatch>();

  for (const app of apps) {
    const descriptionWingetId = extractWingetIdFromDescription(app.description);
    if (descriptionWingetId) {
      tenantMatches.set(app.id, { wingetId: descriptionWingetId, isManaged: true });
      continue;
    }

    const normalizedDisplayName = app.displayName.toLowerCase().trim();
    const explicitWingetId =
      claimedWingetByIntuneAppId.get(app.id) ||
      manualWingetByName.get(normalizedDisplayName) ||
      claimedWingetByName.get(normalizedDisplayName);
    if (explicitWingetId) {
      tenantMatches.set(app.id, { wingetId: explicitWingetId, isManaged: true });
      continue;
    }

    let match = matchAppToWinget(app);

    if (!match || match.confidence === 'low') {
      match = await matchAppToWingetWithDatabase(app, supabase ?? UNUSED_SUPABASE_STUB);
    }

    if (!match || match.confidence === 'low') {
      continue;
    }

    tenantMatches.set(app.id, { wingetId: match.wingetId, isManaged: false });
  }

  return { apps, tenantMatches };
}

interface MatchedApp {
  app: IntuneWin32App;
  wingetId: string;
  isManaged: boolean;
}

export interface ComputeUserAppUpdatesParams {
  userId: string;
  tenantId: string;
  inventory: TenantAppInventory;
}

export interface ComputeUserAppUpdatesResult {
  updates: AppUpdateInfo[];
  checked: CheckedResult[];
  totalApps: number;
}

/**
 * Layers a single user's own upload_history provenance on top of the
 * tenant-wide matches, then runs version comparison. upload_history mapping
 * wins over any tenant-level match (exact deployment provenance beats a
 * description marker or fuzzy guess). Reads upload_history via the DB
 * adapter (works in both Supabase and self-hosted SQLite mode) rather than a
 * raw Supabase query.
 */
export async function computeUserAppUpdates({
  userId,
  tenantId,
  inventory,
}: ComputeUserAppUpdatesParams): Promise<ComputeUserAppUpdatesResult> {
  const { apps, tenantMatches } = inventory;
  const liveIntuneAppIds = new Set(apps.map((a) => a.id));

  const uploadHistoryWingetMap = new Map<string, string>();
  const uploadHistoryVersionMap = new Map<string, string>();
  const tenantHistoryRows = (await getDatabase().uploadHistory.getByUserId(userId, 1000)).filter(
    (row) => row.intune_tenant_id === tenantId
  );

  for (const row of tenantHistoryRows) {
    if (row.intune_app_id && row.winget_id) {
      uploadHistoryWingetMap.set(row.intune_app_id, row.winget_id);
    }
    if (row.intune_app_id && row.version && liveIntuneAppIds.has(row.intune_app_id)) {
      uploadHistoryVersionMap.set(row.intune_app_id, row.version);
    }
  }

  const updates: AppUpdateInfo[] = [];
  const checked: CheckedResult[] = [];
  const matchedApps: MatchedApp[] = [];

  for (const app of apps) {
    const historyWingetId = uploadHistoryWingetMap.get(app.id);
    if (historyWingetId) {
      matchedApps.push({ app, wingetId: historyWingetId, isManaged: true });
      continue;
    }

    const tenantMatch = tenantMatches.get(app.id);
    if (tenantMatch) {
      matchedApps.push({ app, wingetId: tenantMatch.wingetId, isManaged: tenantMatch.isManaged });
      continue;
    }

    checked.push({ app: app.displayName, wingetId: null, result: 'No match found' });
  }

  // Batch lookup covers every matched winget_id, including ones only matched
  // via this user's own upload_history (not part of the tenant-level matches
  // computed in fetchTenantAppInventory) - the set of ids to look up depends
  // on the user, so this can't be hoisted into the tenant-cached step.
  const versionMap = new Map<string, string>();
  const wingetIdsToLookup = Array.from(new Set(matchedApps.map((m) => m.wingetId)));

  if (wingetIdsToLookup.length > 0) {
    const cachedPackages = await getCatalogSource().getAppsByWingetIds(wingetIdsToLookup);
    for (const pkg of cachedPackages as CuratedPackageRow[]) {
      if (pkg.latest_version) {
        versionMap.set(pkg.winget_id, pkg.latest_version);
      }
    }
  }

  function getEffectiveVersion(app: IntuneWin32App): string {
    const displayVer = normalizeVersion(app.displayVersion);
    const historyVer = normalizeVersion(uploadHistoryVersionMap.get(app.id));
    return compareVersions(historyVer, displayVer) > 0 ? historyVer : displayVer;
  }

  const appsByWinget = new Map<string, MatchedApp[]>();
  for (const matched of matchedApps) {
    if (!appsByWinget.has(matched.wingetId)) {
      appsByWinget.set(matched.wingetId, []);
    }
    appsByWinget.get(matched.wingetId)!.push(matched);
  }

  for (const [wingetId, candidates] of appsByWinget.entries()) {
    if (isSelfUpdatingApp(wingetId)) {
      for (const candidate of candidates) {
        checked.push({
          app: candidate.app.displayName,
          wingetId,
          result: 'Self-updating app, excluded from updates',
        });
      }
      continue;
    }

    const latestVersion = versionMap.get(wingetId);

    if (!latestVersion) {
      for (const candidate of candidates) {
        checked.push({ app: candidate.app.displayName, wingetId, result: 'Package not in cache' });
      }
      continue;
    }

    const newestCandidate = candidates.reduce((currentNewest, candidate) => {
      const currentNewestVersion = getEffectiveVersion(currentNewest.app);
      const candidateVersion = getEffectiveVersion(candidate.app);
      const comparison = compareVersions(candidateVersion, currentNewestVersion);

      if (comparison > 0) {
        return candidate;
      }

      if (comparison === 0) {
        const currentModified = new Date(currentNewest.app.lastModifiedDateTime).getTime();
        const candidateModified = new Date(candidate.app.lastModifiedDateTime).getTime();
        if (candidateModified > currentModified) {
          return candidate;
        }
      }

      return currentNewest;
    });

    const currentVersion = getEffectiveVersion(newestCandidate.app);
    const normalizedLatest = normalizeVersion(latestVersion);
    const updateAvailable = hasUpdate(currentVersion, normalizedLatest);

    const groupIsManaged = candidates.some((candidate) => candidate.isManaged);

    if (updateAvailable) {
      updates.push({
        intuneApp: newestCandidate.app,
        currentVersion: currentVersion !== '0.0.0' ? currentVersion : 'Unknown',
        latestVersion: latestVersion,
        wingetId,
        hasUpdate: true,
        isManaged: groupIsManaged,
      });
    }

    for (const candidate of candidates) {
      if (candidate.app.id === newestCandidate.app.id) {
        checked.push({
          app: candidate.app.displayName,
          wingetId,
          result: updateAvailable
            ? `Update available (newest tenant app): ${currentVersion} -> ${normalizedLatest}`
            : 'Up to date (newest tenant app)',
        });
        continue;
      }

      checked.push({
        app: candidate.app.displayName,
        wingetId,
        result: `Older tenant app object (${getEffectiveVersion(candidate.app)}) - compared using newest ${currentVersion}`,
      });
    }
  }

  return { updates, checked, totalApps: apps.length };
}

interface FilterPolicyRow {
  winget_id: string;
  policy_type: string;
  pinned_version: string | null;
}

/**
 * Applies this user+tenant's `ignore`/`pin_version` app_update_policies to a
 * set of detected updates before they're persisted to update_check_results.
 * Same semantics the cron has always applied: an ignored winget_id never
 * surfaces; a pinned winget_id only surfaces if the catalog's latest_version
 * happens to equal the pin target (otherwise the app is left alone entirely,
 * regardless of what's currently installed).
 */
export async function filterUpdatesByPolicy(
  supabase: SupabaseClient | null,
  userId: string,
  tenantId: string,
  updates: AppUpdateInfo[]
): Promise<AppUpdateInfo[]> {
  if (updates.length === 0) return updates;

  // app_update_policies is a Supabase-only table (no SQLite equivalent) -
  // self-hosted installs have no policies to apply, so every detected update
  // passes through unfiltered rather than erroring.
  if (!supabase || !isSupabaseConfigured()) return updates;

  const { data: policies } = await supabase
    .from('app_update_policies')
    .select('winget_id, policy_type, pinned_version')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .in('policy_type', ['ignore', 'pin_version']);

  if (!policies || policies.length === 0) return updates;

  const ignored = new Set<string>();
  const pinned = new Map<string, string>();
  for (const policy of policies as FilterPolicyRow[]) {
    if (policy.policy_type === 'ignore') {
      ignored.add(policy.winget_id);
    } else if (policy.policy_type === 'pin_version' && policy.pinned_version) {
      pinned.set(policy.winget_id, policy.pinned_version);
    }
  }

  if (ignored.size === 0 && pinned.size === 0) return updates;

  return updates.filter((update) => {
    if (!update.wingetId) return true;
    if (ignored.has(update.wingetId)) return false;
    const pinnedVersion = pinned.get(update.wingetId);
    if (pinnedVersion && update.latestVersion !== pinnedVersion) return false;
    return true;
  });
}
