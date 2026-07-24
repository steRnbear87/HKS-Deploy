/**
 * Device BIOS version snapshot capture.
 *
 * Unlike the other two snapshot jobs in this directory, BIOS version has no
 * bulk Graph endpoint - `hardwareInformation.systemManagementBIOSVersion`
 * comes back `null` on the tenant-wide `deviceManagement/managedDevices`
 * list even when explicitly selected, and only populates on a per-device
 * fetch (confirmed empirically against a real tenant). For ~2,591 devices
 * that's ~2,591 individual Graph calls, which cannot complete in one budget
 * window the way the single-sweep jobs in this directory do.
 *
 * So this is a current-state CACHE (one row per device, upserted in place -
 * see lib/db/types.ts's DeviceBiosInfoRecord doc comment), not a
 * daily-accumulating snapshot, and it resumes across invocations using the
 * cache table itself as the "remaining work" tracker: each call re-sweeps
 * the tenant's current Windows device ids (cheap, one paginated list call),
 * diffs against which of those already have a row captured today, and
 * fans out over only what's left. A device successfully queried gets a row
 * written even if the reported value is null - that's what distinguishes
 * "checked, nothing reported" from "not yet attempted," so it isn't
 * refetched every single invocation forever. Only a retryable failure
 * (budget cutoff, or fetchWithRetry exhausting its own retries) leaves a
 * device un-rowed so it's picked up again next time.
 *
 * Deliberately NOT wired through snapshot.ts (the device-health job): that
 * module gates on "already ran today, skip the whole tenant," which is the
 * wrong shape for a job that needs a fresh device-id list on every
 * invocation (a device retired or enrolled mid-day should be reflected the
 * same day, not the next).
 */

import { getDatabase } from '@/lib/db';
import {
  GRAPH_API_BASE,
  fetchWithRetry,
  getServicePrincipalToken,
  invalidateServicePrincipalToken,
} from '@/lib/intune/graph-client';
import type { HardwareInformation } from '@/types/devices';

// hardwareInformation (needed for BIOS) is beta-only - v1.0 returns 400
// "Could not find a property named 'hardwareInformation'" - confirmed
// empirically, same beta-only pattern as detectedApps elsewhere in this
// codebase. The id-only sweep below has no such restriction and stays on
// v1.0 (GRAPH_API_BASE) to match the existing devices list route.
const GRAPH_API_BASE_BETA = 'https://graph.microsoft.com/beta';

// One id-only sweep per invocation - same cost profile as the other jobs'
// single sweeps, cheap relative to the per-device fan-out that follows.
const ID_SWEEP_BUDGET_MS = 40_000;
// Per-device fan-out concurrency. Matches the only real precedent for this
// shape of work (lib/intune/deployment-drift.ts) rather than guessing
// higher without observed 429 behavior for sustained individual-device GETs.
const CONCURRENCY = 4;
// Upsert progress in small batches as results come in, not all at the end,
// so a mid-run restart never loses already-fetched devices.
const PERSIST_CHUNK = 25;

interface GraphFetchError extends Error {
  status: number;
}

function todayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** One paginated sweep of Windows device ids - BIOS is a Windows-only field,
 * so non-Windows devices are excluded up front rather than looking
 * "missing" and being wastefully refetched every invocation forever. */
async function fetchWindowsDeviceIds(tenantId: string, token: string, deadline: number): Promise<string[]> {
  const ids: string[] = [];
  let nextUrl: string | null =
    `${GRAPH_API_BASE}/deviceManagement/managedDevices?$select=id&$filter=${encodeURIComponent("operatingSystem eq 'Windows'")}`;

  while (nextUrl) {
    if (Date.now() >= deadline) break;

    const response = await fetchWithRetry(
      nextUrl,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
      3,
      deadline
    );

    if (!response.ok) {
      if (response.status === 401) invalidateServicePrincipalToken(tenantId);
      console.error(`[bios-snapshot] Graph managedDevices id-sweep ${response.status} for tenant ${tenantId}`);
      break;
    }

    const data: { value?: Array<{ id: string }>; '@odata.nextLink'?: string } = await response.json();
    if (Array.isArray(data.value)) {
      ids.push(...data.value.map((d) => d.id));
    }
    nextUrl = data['@odata.nextLink'] ?? null;
  }

  return ids;
}

type BiosFetchResult =
  | { outcome: 'captured'; biosVersion: string | null }
  | { outcome: 'skip' } // 404 - device removed, will drop out of the id sweep naturally
  | { outcome: 'retry' }; // budget/retryable failure - leave for next invocation

async function fetchBiosVersion(
  deviceId: string,
  token: string,
  tenantId: string,
  deadline: number
): Promise<BiosFetchResult> {
  if (Date.now() >= deadline) return { outcome: 'retry' };

  try {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE_BETA}/deviceManagement/managedDevices/${encodeURIComponent(deviceId)}?$select=hardwareInformation`,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
      3,
      deadline
    );

    if (response.status === 404) {
      await response.text().catch(() => {});
      return { outcome: 'skip' };
    }

    if (!response.ok) {
      if (response.status === 401) invalidateServicePrincipalToken(tenantId);
      return { outcome: 'retry' };
    }

    const data: { hardwareInformation?: HardwareInformation | null } = await response.json();
    return { outcome: 'captured', biosVersion: data.hardwareInformation?.systemManagementBIOSVersion ?? null };
  } catch (error) {
    const graphError = error as GraphFetchError;
    const budgetExhausted =
      (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) ||
      Date.now() >= deadline;
    if (budgetExhausted) return { outcome: 'retry' };
    console.error(`[bios-snapshot] Failed fetching device ${deviceId} for tenant ${tenantId}:`, graphError);
    return { outcome: 'retry' };
  }
}

export async function captureBiosSnapshotForTenant(tenantId: string, budgetMs: number): Promise<void> {
  const token = await getServicePrincipalToken(tenantId);
  if (!token) {
    console.error(`[bios-snapshot] Failed to get Graph token for tenant ${tenantId}, skipping`);
    return;
  }

  const deadline = Date.now() + budgetMs;
  const idSweepDeadline = Math.min(deadline, Date.now() + ID_SWEEP_BUDGET_MS);
  const currentDeviceIds = await fetchWindowsDeviceIds(tenantId, token, idSweepDeadline);
  if (currentDeviceIds.length === 0) return;

  const db = getDatabase();

  // Prune cache rows for devices no longer in the fleet before computing
  // remaining work, so a retired device's stale row can't linger forever.
  await db.deviceBiosInfo.pruneRemoved(tenantId, currentDeviceIds);

  const cached = await db.deviceBiosInfo.getByTenantId(tenantId);
  const capturedTodaySet = new Set(
    cached.filter((row) => new Date(row.captured_at) >= todayStart()).map((row) => row.device_id)
  );
  const remaining = currentDeviceIds.filter((id) => !capturedTodaySet.has(id));
  if (remaining.length === 0) return;

  let buffer: Array<{ tenant_id: string; device_id: string; bios_version: string | null; captured_at: string }> = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    await db.deviceBiosInfo.upsertMany(buffer);
    buffer = [];
  };

  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    if (Date.now() >= deadline) break;

    const chunk = remaining.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((id) => fetchBiosVersion(id, token, tenantId, deadline)));

    const now = new Date().toISOString();
    chunk.forEach((deviceId, idx) => {
      const result = results[idx];
      if (result.outcome === 'captured') {
        buffer.push({ tenant_id: tenantId, device_id: deviceId, bios_version: result.biosVersion, captured_at: now });
      }
      // 'skip' and 'retry' write nothing - see BiosFetchResult doc above.
    });

    if (buffer.length >= PERSIST_CHUNK) {
      await flush();
    }
  }

  await flush();
}

/** Runs BIOS capture for every known tenant, capping each tenant's share of
 * overallBudgetMs by whatever time remains so a multi-tenant run can't blow
 * past the caller's total budget. */
export async function captureDueBiosSnapshots(overallBudgetMs: number): Promise<void> {
  const db = getDatabase();
  const tenantIds = await db.deviceHealthSnapshots.getKnownTenantIds();
  const overallDeadline = Date.now() + overallBudgetMs;

  for (const tenantId of tenantIds) {
    const remaining = overallDeadline - Date.now();
    if (remaining <= 0) break;

    try {
      await captureBiosSnapshotForTenant(tenantId, remaining);
    } catch (error) {
      console.error(`[bios-snapshot] Failed for tenant ${tenantId}:`, error);
    }
  }
}
