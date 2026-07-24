/**
 * Check Updates Cron Job
 * Runs daily to detect available updates across each tenant's full Intune app
 * inventory (not just apps IntuneGet itself deployed) - the same live scan
 * app/api/intune/apps/updates/route.ts runs on-demand, automated here.
 * Stores results in update_check_results for notification processing.
 * Triggers auto-updates for apps with auto_update policy (Supabase mode only
 * - see the SQLite branch below for why).
 */

import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parseVersion } from '@/lib/version-compare';
import {
  AutoUpdateTrigger,
  getLatestInstallerInfo,
} from '@/lib/auto-update/trigger';
import { AppUpdatePolicy, shouldSkipUpdate } from '@/types/update-policies';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { getDatabase } from '@/lib/db';
import {
  fetchTenantAppInventory,
  computeUserAppUpdates,
  filterUpdatesByPolicy,
  type TenantAppInventory,
} from '@/lib/intune/live-app-updates';
import {
  fetchTenantDetectedAppsIndex,
  computeDeploymentDriftForUpdates,
  type TenantDetectedAppsIndex,
  type DriftResult,
} from '@/lib/intune/deployment-drift';
import type { AppUpdateInfo } from '@/types/inventory';

const BATCH_SIZE = 50;

// Leaves headroom under maxDuration (300s) so a tenant mid-scan when the
// budget runs out is skipped cleanly rather than the whole run timing out.
const SCAN_BUDGET_MS = 4.5 * 60 * 1000;

interface UserTenantRow {
  user_id: string;
  intune_tenant_id: string | null;
}

interface UpdateCheckInsert {
  user_id: string;
  tenant_id: string;
  winget_id: string;
  intune_app_id: string;
  display_name: string;
  current_version: string;
  latest_version: string;
  is_critical: boolean;
  is_managed: boolean;
  large_icon_type: string | null;
  large_icon_value: string | null;
  notified_at: string | null;
  dismissed_at: string | null;
  detected_at: string;
  updated_at: string;
}

interface AutoUpdateResult {
  triggered: number;
  skipped: number;
  failed: number;
  errors: string[];
}

interface ExistingUpdateCheckRow {
  id: string;
  user_id: string;
  tenant_id: string;
  winget_id: string;
  intune_app_id: string;
}

interface DriftInsert {
  user_id: string;
  tenant_id: string;
  winget_id: string;
  intune_app_id: string;
  display_name: string;
  expected_version: string;
  total_devices_scanned: number;
  on_expected_count: number;
  behind_count: number;
  ahead_count: number;
  partial: boolean;
  scanned_at: string;
}

function toDriftInsert(userId: string, tenantId: string, result: DriftResult, scannedAt: string): DriftInsert {
  return {
    user_id: userId,
    tenant_id: tenantId,
    winget_id: result.wingetId,
    intune_app_id: result.intuneAppId,
    display_name: result.displayName,
    expected_version: result.expectedVersion,
    total_devices_scanned: result.totalDevicesScanned,
    on_expected_count: result.onExpectedCount,
    behind_count: result.behindCount,
    ahead_count: result.aheadCount,
    partial: result.partial,
    scanned_at: scannedAt,
  };
}

/**
 * Best-effort drift computation for one tenant's managed updates. Never
 * throws - a Graph hiccup here must not fail or block the underlying
 * update-detection write, which is the primary job of this cron.
 */
async function computeDriftSafely(
  userId: string,
  tenantId: string,
  updates: AppUpdateInfo[],
  getDetectedAppsIndex: (tenantId: string) => Promise<TenantDetectedAppsIndex | null>
): Promise<DriftInsert[]> {
  const managedUpdates = updates.filter((u) => u.isManaged);
  if (managedUpdates.length === 0) return [];

  try {
    const [detectedAppsIndex, graphToken] = await Promise.all([
      getDetectedAppsIndex(tenantId),
      getServicePrincipalToken(tenantId),
    ]);
    if (!detectedAppsIndex || !graphToken) return [];

    const results = await computeDeploymentDriftForUpdates(managedUpdates, detectedAppsIndex, tenantId, graphToken);
    const scannedAt = new Date().toISOString();
    return results.map((result) => toDriftInsert(userId, tenantId, result, scannedAt));
  } catch (error) {
    console.error(`[deployment-drift] Failed for user ${userId} / tenant ${tenantId}:`, error);
    return [];
  }
}

function isCriticalUpdate(currentVersion: string, latestVersion: string): boolean {
  const current = parseVersion(currentVersion || '0.0.0');
  const latest = parseVersion(latestVersion || '0.0.0');
  return latest.major > current.major;
}

/**
 * Process auto-updates for detected updates. Supabase-only (app_update_policies
 * has no SQLite equivalent) - never called from the SQLite branch.
 */
async function processAutoUpdates(
  supabase: SupabaseClient,
  autoUpdateTrigger: AutoUpdateTrigger,
  updates: UpdateCheckInsert[]
): Promise<AutoUpdateResult> {
  const result: AutoUpdateResult = {
    triggered: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Get all policies for the users/tenants/apps with updates
  const policyKeys = updates.map((u) => ({
    user_id: u.user_id,
    tenant_id: u.tenant_id,
    winget_id: u.winget_id,
  }));

  // Fetch policies in batches
  const uniqueUserIds = [...new Set(policyKeys.map((p) => p.user_id))];
  const { data: policies, error: policyError } = await supabase
    .from('app_update_policies')
    .select('*')
    .in('user_id', uniqueUserIds)
    .eq('policy_type', 'auto_update')
    .eq('is_enabled', true);

  if (policyError) {
    result.errors.push(`Failed to fetch policies: ${policyError.message}`);
    return result;
  }

  if (!policies || policies.length === 0) {
    return result;
  }

  // Create lookup map for policies
  const policyMap = new Map<string, AppUpdatePolicy>();
  policies.forEach((policy: AppUpdatePolicy) => {
    const key = `${policy.user_id}:${policy.tenant_id}:${policy.winget_id}`;
    policyMap.set(key, policy);
  });

  // Process each update that has an auto-update policy
  for (const update of updates) {
    const policyKey = `${update.user_id}:${update.tenant_id}:${update.winget_id}`;
    const policy = policyMap.get(policyKey);

    if (!policy) {
      // No auto-update policy for this app
      continue;
    }

    // Check if update should be skipped based on policy
    if (shouldSkipUpdate(policy, update.latest_version)) {
      result.skipped++;
      continue;
    }

    try {
      // Get installer info for the new version
      const installerInfo = await getLatestInstallerInfo(supabase, update.winget_id);

      if (!installerInfo) {
        result.errors.push(
          `No installer info found for ${update.winget_id} v${update.latest_version}`
        );
        result.failed++;
        continue;
      }

      // Add current version to installer info.
      // Look up the most recent upload_history record to get the current
      // Intune app ID, since update_check_results.intune_app_id can be stale
      // if the app was redeployed since the last update check.
      installerInfo.currentVersion = update.current_version;
      const { data: latestUploadForCron } = await supabase
        .from('upload_history')
        .select('intune_app_id')
        .eq('user_id', update.user_id)
        .eq('intune_tenant_id', update.tenant_id)
        .eq('winget_id', update.winget_id)
        .order('deployed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      installerInfo.currentIntuneAppId =
        latestUploadForCron?.intune_app_id || update.intune_app_id;

      // Trigger the auto-update
      const triggerResult = await autoUpdateTrigger.triggerAutoUpdate(
        policy,
        installerInfo
      );

      if (triggerResult.success) {
        result.triggered++;
      } else if (triggerResult.skipped) {
        result.skipped++;
      } else {
        result.failed++;
        result.errors.push(
          `Failed to trigger auto-update for ${update.winget_id}: ${triggerResult.error}`
        );
      }
    } catch (error) {
      result.failed++;
      result.errors.push(
        `Error processing auto-update for ${update.winget_id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return result;
}

function makeTenantInventoryCache(supabase: SupabaseClient | null) {
  // Cached per tenant for the lifetime of this run - the Graph app list and
  // its matching/version lookups are identical for every user of a tenant, so
  // a tenant with many users being checked only gets scanned once. A cached
  // `null` means the tenant's Graph token/inventory fetch failed this run;
  // don't retry it for every user, just skip.
  const cache = new Map<string, TenantAppInventory | null>();

  return async function getTenantInventory(tenantId: string): Promise<TenantAppInventory | null> {
    if (cache.has(tenantId)) {
      return cache.get(tenantId)!;
    }
    try {
      const graphToken = await getServicePrincipalToken(tenantId);
      if (!graphToken) {
        cache.set(tenantId, null);
        return null;
      }
      const inventory = await fetchTenantAppInventory(supabase, tenantId, graphToken);
      cache.set(tenantId, inventory);
      return inventory;
    } catch (error) {
      console.error(`Failed to fetch app inventory for tenant ${tenantId}:`, error);
      cache.set(tenantId, null);
      return null;
    }
  };
}

function makeDetectedAppsIndexCache() {
  // Cached per tenant for the lifetime of this run, same reasoning as
  // makeTenantInventoryCache: the tenant-wide detectedApps sweep is identical
  // for every user of a tenant, so it only needs to run once per run.
  const cache = new Map<string, TenantDetectedAppsIndex | null>();

  return async function getDetectedAppsIndex(tenantId: string): Promise<TenantDetectedAppsIndex | null> {
    if (cache.has(tenantId)) {
      return cache.get(tenantId)!;
    }
    try {
      const graphToken = await getServicePrincipalToken(tenantId);
      if (!graphToken) {
        cache.set(tenantId, null);
        return null;
      }
      const index = await fetchTenantDetectedAppsIndex(tenantId, graphToken);
      cache.set(tenantId, index);
      return index;
    } catch (error) {
      console.error(`[deployment-drift] Failed to fetch detectedApps index for tenant ${tenantId}:`, error);
      cache.set(tenantId, null);
      return null;
    }
  };
}

/**
 * Self-hosted SQLite branch. There's no notification_preferences/
 * webhook_configurations/app_update_policies here (Supabase-only, not
 * ported), so recipient discovery is simply every distinct (user, tenant)
 * pair with deployment history. No auto-update triggering (nothing to read
 * a policy from) and no ignore/pin filtering (filterUpdatesByPolicy no-ops
 * without Supabase) - just detection and persistence.
 */
async function runSqliteModeCron(): Promise<NextResponse> {
  const db = getDatabase();
  const scanDeadline = Date.now() + SCAN_BUDGET_MS;
  const getTenantInventory = makeTenantInventoryCache(null);
  const getDetectedAppsIndex = makeDetectedAppsIndexCache();

  const errors: string[] = [];
  const allRows: UpdateCheckInsert[] = [];
  const allDriftRows: DriftInsert[] = [];
  const activeKeys = new Set<string>();
  let totalUsersChecked = 0;
  let scanBudgetExceeded = false;

  try {
    const pairs = await db.uploadHistory.getDistinctUserTenantPairs();

    for (const { user_id: userId, intune_tenant_id: tenantId } of pairs) {
      if (!tenantId) continue;
      if (Date.now() >= scanDeadline) {
        scanBudgetExceeded = true;
        break;
      }

      totalUsersChecked++;

      const inventory = await getTenantInventory(tenantId);
      if (!inventory) {
        errors.push(`Skipped tenant ${tenantId}: could not fetch app inventory`);
        continue;
      }

      let updates;
      try {
        const result = await computeUserAppUpdates({ userId, tenantId, inventory });
        updates = result.updates;
      } catch (error) {
        errors.push(
          `Error computing updates for user ${userId} / tenant ${tenantId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        continue;
      }

      updates = updates.filter((u) => u.wingetId && u.currentVersion !== 'Unknown');

      const now = new Date().toISOString();
      for (const update of updates) {
        const wingetId = update.wingetId as string;
        const key = `${userId}:${tenantId}:${wingetId}:${update.intuneApp.id}`;
        allRows.push({
          user_id: userId,
          tenant_id: tenantId,
          winget_id: wingetId,
          intune_app_id: update.intuneApp.id,
          display_name: update.intuneApp.displayName,
          current_version: update.currentVersion,
          latest_version: update.latestVersion,
          is_critical: isCriticalUpdate(update.currentVersion, update.latestVersion),
          is_managed: update.isManaged,
          large_icon_type: update.intuneApp.largeIcon?.type || null,
          large_icon_value: update.intuneApp.largeIcon?.value || null,
          notified_at: null,
          dismissed_at: null,
          detected_at: now,
          updated_at: now,
        });
        activeKeys.add(key);
      }

      if (Date.now() < scanDeadline) {
        allDriftRows.push(...(await computeDriftSafely(userId, tenantId, updates, getDetectedAppsIndex)));
      }
    }

    if (scanBudgetExceeded) {
      errors.push('Scan budget exceeded - remaining users/tenants will be checked on the next run');
    }

    if (allRows.length > 0) {
      try {
        await db.updateCheckResults.upsertMany(allRows);
      } catch (error) {
        errors.push(`Error upserting updates: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (allDriftRows.length > 0) {
      try {
        await db.deploymentDrift.upsertMany(allDriftRows);
      } catch (error) {
        errors.push(`Error upserting deployment drift: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Stale-row cleanup, skipped if the budget ran out (activeKeys would be
    // incomplete, and still-valid rows for unreached users would be deleted).
    if (!scanBudgetExceeded) {
      const userIds = [...new Set(pairs.map((p) => p.user_id))];
      const existingRows = await db.updateCheckResults.getByUserIds(userIds);
      const staleIds = existingRows
        .filter((row) => !activeKeys.has(`${row.user_id}:${row.tenant_id}:${row.winget_id}:${row.intune_app_id}`))
        .map((row) => row.id);
      if (staleIds.length > 0) {
        await db.updateCheckResults.deleteByIds(staleIds);
      }
    }

    await db.updateCheckResults.deleteOlderThan(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    );
    await db.deploymentDrift.deleteOlderThan(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    );

    return NextResponse.json({
      success: errors.length === 0,
      usersChecked: totalUsersChecked,
      updatesFound: allRows.length,
      autoUpdates: { triggered: 0, skipped: 0, failed: 0 },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

async function runSupabaseModeCron(supabaseUrl: string, supabaseServiceKey: string): Promise<NextResponse> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const autoUpdateTrigger = new AutoUpdateTrigger(supabaseUrl, supabaseServiceKey);
  const scanDeadline = Date.now() + SCAN_BUDGET_MS;
  const getTenantInventory = makeTenantInventoryCache(supabase);
  const getDetectedAppsIndex = makeDetectedAppsIndexCache();

  try {
    // Get users with notifications enabled
    const { data: notificationUsers, error: usersError } = await supabase
      .from('notification_preferences')
      .select('user_id, notify_critical_only')
      .eq('email_enabled', true);

    if (usersError) {
      throw usersError;
    }

    // Also get users with enabled webhooks
    const { data: webhookUsers, error: webhooksError } = await supabase
      .from('webhook_configurations')
      .select('user_id')
      .eq('is_enabled', true);

    if (webhooksError) {
      throw webhooksError;
    }

    // Also get users with auto-update policies
    const { data: autoUpdateUsers, error: autoUpdateError } = await supabase
      .from('app_update_policies')
      .select('user_id')
      .eq('policy_type', 'auto_update')
      .eq('is_enabled', true);

    if (autoUpdateError) {
      throw autoUpdateError;
    }

    // Always include users that have deployed apps tracked in upload_history.
    // Without this, updates can stay at zero for users who did not enable notifications.
    const { data: deploymentUsers, error: deploymentUsersError } = await supabase
      .from('upload_history')
      .select('user_id');

    if (deploymentUsersError) {
      throw deploymentUsersError;
    }

    // Combine unique user IDs
    const userIds = new Set<string>();
    notificationUsers?.forEach((u) => userIds.add(u.user_id));
    webhookUsers?.forEach((u) => userIds.add(u.user_id));
    autoUpdateUsers?.forEach((u) => userIds.add(u.user_id));
    deploymentUsers?.forEach((u) => userIds.add(u.user_id));

    if (userIds.size === 0) {
      return NextResponse.json({
        success: true,
        message: 'No users with tracked deployments',
        usersChecked: 0,
        updatesFound: 0,
        autoUpdates: { triggered: 0, skipped: 0, failed: 0 },
      });
    }

    let totalUpdatesFound = 0;
    let totalUsersChecked = 0;
    const errors: string[] = [];
    const allUpdates: UpdateCheckInsert[] = [];
    const allDriftRows: DriftInsert[] = [];
    const activeUpdateKeys = new Set<string>();
    let scanBudgetExceeded = false;

    // Process users in batches
    const userIdArray = Array.from(userIds);

    outer: for (let i = 0; i < userIdArray.length; i += BATCH_SIZE) {
      const batch = userIdArray.slice(i, i + BATCH_SIZE);

      // Distinct (user, tenant) pairs to check for this batch, derived from
      // each user's own upload_history rows - the reliable existing source of
      // user->tenant mapping in this codebase. Only the pairing is needed
      // here; computeUserAppUpdates() re-reads each user's upload_history
      // itself when building their per-user matches.
      const { data: userTenantRows, error: userTenantError } = await supabase
        .from('upload_history')
        .select('user_id, intune_tenant_id')
        .in('user_id', batch);

      if (userTenantError) {
        errors.push(`Error fetching user/tenant pairs: ${userTenantError.message}`);
        continue;
      }

      const tenantPairs = new Map<string, { userId: string; tenantId: string }>();
      (userTenantRows as UserTenantRow[] | null)?.forEach((row) => {
        if (!row.intune_tenant_id) return;
        const key = `${row.user_id}:${row.intune_tenant_id}`;
        tenantPairs.set(key, { userId: row.user_id, tenantId: row.intune_tenant_id });
      });

      if (tenantPairs.size === 0) {
        continue;
      }

      // Load prior update rows for this batch so the upsert can preserve
      // notified_at for unchanged updates but reset it to null when
      // latest_version changed. Without the reset, an app that was already
      // notified for an older version never notifies again on the next bump.
      const { data: priorRows } = await supabase
        .from('update_check_results')
        .select('user_id, tenant_id, winget_id, intune_app_id, latest_version, notified_at')
        .in('user_id', batch);
      const priorMap = new Map<string, { latest_version: string; notified_at: string | null }>();
      (priorRows as Array<{ user_id: string; tenant_id: string; winget_id: string; intune_app_id: string; latest_version: string; notified_at: string | null }> | null)?.forEach(
        (r) =>
          priorMap.set(`${r.user_id}:${r.tenant_id}:${r.winget_id}:${r.intune_app_id}`, {
            latest_version: r.latest_version,
            notified_at: r.notified_at,
          })
      );

      const updates: UpdateCheckInsert[] = [];

      for (const { userId, tenantId } of tenantPairs.values()) {
        if (Date.now() >= scanDeadline) {
          scanBudgetExceeded = true;
          break outer;
        }

        totalUsersChecked++;

        const inventory = await getTenantInventory(tenantId);
        if (!inventory) {
          errors.push(`Skipped tenant ${tenantId}: could not fetch app inventory`);
          continue;
        }

        let userUpdates;
        try {
          const result = await computeUserAppUpdates({ userId, tenantId, inventory });
          userUpdates = result.updates;
        } catch (error) {
          errors.push(
            `Error computing updates for user ${userId} / tenant ${tenantId}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          continue;
        }

        userUpdates = userUpdates.filter((u) => u.wingetId && u.currentVersion !== 'Unknown');
        userUpdates = await filterUpdatesByPolicy(supabase, userId, tenantId, userUpdates);

        for (const update of userUpdates) {
          const wingetId = update.wingetId as string;
          const key = `${userId}:${tenantId}:${wingetId}:${update.intuneApp.id}`;
          const prior = priorMap.get(key);
          const notifiedAt =
            prior && prior.latest_version === update.latestVersion ? prior.notified_at : null;

          const updateRecord: UpdateCheckInsert = {
            user_id: userId,
            tenant_id: tenantId,
            winget_id: wingetId,
            intune_app_id: update.intuneApp.id,
            display_name: update.intuneApp.displayName,
            current_version: update.currentVersion,
            latest_version: update.latestVersion,
            is_critical: isCriticalUpdate(update.currentVersion, update.latestVersion),
            is_managed: update.isManaged,
            large_icon_type: update.intuneApp.largeIcon?.type || null,
            large_icon_value: update.intuneApp.largeIcon?.value || null,
            notified_at: notifiedAt,
            dismissed_at: null,
            detected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          updates.push(updateRecord);
          allUpdates.push(updateRecord);
          activeUpdateKeys.add(key);
        }

        if (Date.now() < scanDeadline) {
          allDriftRows.push(...(await computeDriftSafely(userId, tenantId, userUpdates, getDetectedAppsIndex)));
        }
      }

      // Upsert updates
      if (updates.length > 0) {
        const { error: upsertError } = await supabase
          .from('update_check_results')
          .upsert(updates, {
            onConflict: 'user_id,tenant_id,winget_id,intune_app_id',
          });

        if (upsertError) {
          errors.push(`Error upserting updates: ${upsertError.message}`);
        } else {
          totalUpdatesFound += updates.length;
        }
      }

      // Rate limiting between batches
      if (i + BATCH_SIZE < userIdArray.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    if (scanBudgetExceeded) {
      errors.push('Scan budget exceeded - remaining users/tenants will be checked on the next run');
    }

    // Remove stale rows for processed users that are no longer active.
    // This clears outdated entries from older Intune app objects and resolved updates.
    // Skipped when the scan budget ran out mid-run: activeUpdateKeys would be
    // incomplete for the users not yet reached, and their still-valid rows
    // would be wrongly deleted as "stale".
    if (userIdArray.length > 0 && !scanBudgetExceeded) {
      const { data: existingRows, error: existingRowsError } = await supabase
        .from('update_check_results')
        .select('id, user_id, tenant_id, winget_id, intune_app_id')
        .in('user_id', userIdArray);

      if (existingRowsError) {
        errors.push(`Error loading existing update rows: ${existingRowsError.message}`);
      } else if (existingRows) {
        const staleIds = (existingRows as ExistingUpdateCheckRow[])
          .filter((row) => {
            const key = `${row.user_id}:${row.tenant_id}:${row.winget_id}:${row.intune_app_id}`;
            return !activeUpdateKeys.has(key);
          })
          .map((row) => row.id);

        if (staleIds.length > 0) {
          const { error: staleDeleteError } = await supabase
            .from('update_check_results')
            .delete()
            .in('id', staleIds);

          if (staleDeleteError) {
            errors.push(`Error deleting stale updates: ${staleDeleteError.message}`);
          }
        }
      }
    }

    if (allDriftRows.length > 0) {
      try {
        await getDatabase().deploymentDrift.upsertMany(allDriftRows);
      } catch (error) {
        errors.push(`Error upserting deployment drift: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Process auto-updates for all detected updates
    let autoUpdateResult: AutoUpdateResult = {
      triggered: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    if (allUpdates.length > 0) {
      autoUpdateResult = await processAutoUpdates(
        supabase,
        autoUpdateTrigger,
        allUpdates
      );

      if (autoUpdateResult.errors.length > 0) {
        errors.push(...autoUpdateResult.errors);
      }
    }

    // Clean up old update records that no longer apply
    // (app was updated or removed)
    const { error: cleanupError } = await supabase
      .from('update_check_results')
      .delete()
      .lt('detected_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    if (cleanupError) {
      errors.push(`Cleanup error: ${cleanupError.message}`);
    }

    try {
      await getDatabase().deploymentDrift.deleteOlderThan(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      );
    } catch (error) {
      errors.push(`Deployment drift cleanup error: ${error instanceof Error ? error.message : String(error)}`);
    }

    return NextResponse.json({
      success: errors.length === 0,
      usersChecked: totalUsersChecked,
      updatesFound: totalUpdatesFound,
      autoUpdates: {
        triggered: autoUpdateResult.triggered,
        skipped: autoUpdateResult.skipped,
        failed: autoUpdateResult.failed,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceKey) {
    return runSupabaseModeCron(supabaseUrl, supabaseServiceKey);
  }

  return runSqliteModeCron();
}

// Allow up to 5 minutes for the job to complete
export const maxDuration = 300;
