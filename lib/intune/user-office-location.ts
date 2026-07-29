/**
 * Primary-user office location snapshot capture.
 *
 * "Office location" (Entra ID user property `officeLocation`, populated from
 * on-prem AD's `physicalDeliveryOfficeName` via AD Connect where applicable)
 * lives on the USER object, not the device - so unlike BIOS version (one
 * per-device Graph call each) this is a per-USER fan-out, deduplicated by
 * userPrincipalName across the fleet. Many devices share one primary user,
 * so this is typically far cheaper than a per-device sweep.
 *
 * Uses Microsoft Graph's $batch endpoint (up to 20 sub-requests per POST) to
 * cut round-trips - each sub-request still counts against the tenant's Graph
 * throttling budget individually, but wall-clock time drops substantially
 * versus one HTTP request per user.
 *
 * Same current-state CACHE shape as device_bios_info (lib/db/types.ts's
 * UserOfficeLocationRecord doc comment): a row with office_location = NULL
 * means Graph was queried and the user genuinely has none set, not "not yet
 * captured". Resumes across invocations by re-sweeping the tenant's current
 * distinct userPrincipalNames (cheap, one paginated list call) and diffing
 * against which are already captured today.
 */

import { getDatabase } from '@/lib/db';
import {
  GRAPH_API_BASE,
  fetchWithRetry,
  getServicePrincipalToken,
  invalidateServicePrincipalToken,
} from '@/lib/intune/graph-client';

// One id-only sweep per invocation - same cost profile as the other jobs'
// single sweeps, cheap relative to the per-user fan-out that follows.
const ID_SWEEP_BUDGET_MS = 40_000;
// Graph $batch hard limit on sub-requests per POST.
const BATCH_SIZE = 20;
// Parallel $batch POSTs in flight. Matches the per-device fan-out precedent
// (lib/device-health/bios-snapshot.ts) rather than guessing higher without
// observed 429 behavior for sustained batched user lookups.
const CONCURRENCY = 4;
// Upsert progress in small batches as results come in, not all at the end,
// so a mid-run restart never loses already-fetched users.
const PERSIST_CHUNK = 50;

interface GraphFetchError extends Error {
  status: number;
}

function todayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** One paginated sweep of every device's userPrincipalName, deduplicated
 * (case-insensitively, stored lowercased) into a distinct-user list. */
async function fetchDistinctUserPrincipalNames(
  tenantId: string,
  token: string,
  deadline: number
): Promise<string[]> {
  const upns = new Set<string>();
  let nextUrl: string | null =
    `${GRAPH_API_BASE}/deviceManagement/managedDevices?$select=userPrincipalName`;

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
      console.error(`[user-office-location] Graph managedDevices sweep ${response.status} for tenant ${tenantId}`);
      break;
    }

    const data: { value?: Array<{ userPrincipalName?: string | null }>; '@odata.nextLink'?: string } =
      await response.json();
    if (Array.isArray(data.value)) {
      for (const device of data.value) {
        if (device.userPrincipalName) {
          upns.add(device.userPrincipalName.toLowerCase());
        }
      }
    }
    nextUrl = data['@odata.nextLink'] ?? null;
  }

  return Array.from(upns);
}

interface BatchSubRequest {
  id: string;
  method: 'GET';
  url: string;
}

interface BatchSubResponse {
  id: string;
  status: number;
  body?: { officeLocation?: string | null };
}

/** POSTs one $batch request (max BATCH_SIZE sub-requests) and returns the raw
 * sub-responses. Throws on transport/HTTP-level failure of the batch call
 * itself; individual sub-request failures are reported per-id in the response. */
async function graphBatch(
  token: string,
  requests: BatchSubRequest[],
  deadline: number
): Promise<BatchSubResponse[]> {
  if (requests.length === 0) return [];

  const response = await fetchWithRetry(
    `${GRAPH_API_BASE}/$batch`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    },
    3,
    deadline
  );

  if (!response.ok) {
    const error = new Error(`Graph $batch ${response.status}`) as GraphFetchError;
    error.status = response.status;
    throw error;
  }

  const data: { responses?: BatchSubResponse[] } = await response.json();
  return data.responses ?? [];
}

type OfficeLocationResult =
  | { outcome: 'captured'; officeLocation: string | null }
  | { outcome: 'skip' } // user not found (404) - removed/guest account, will drop out of the sweep naturally
  | { outcome: 'retry' } // budget/retryable failure - leave for next invocation
  | { outcome: 'permission_denied' }; // tenant's app registration lacks User.Read.All - not retryable within this run

/** Resolves one chunk (<=BATCH_SIZE) of userPrincipalNames via a single
 * $batch POST, keyed back to each upn by array index as the sub-request id. */
async function fetchOfficeLocationsChunk(
  upns: string[],
  token: string,
  tenantId: string,
  deadline: number
): Promise<Map<string, OfficeLocationResult>> {
  const results = new Map<string, OfficeLocationResult>();

  if (Date.now() >= deadline) {
    for (const upn of upns) results.set(upn, { outcome: 'retry' });
    return results;
  }

  const requests: BatchSubRequest[] = upns.map((upn, i) => ({
    id: String(i),
    method: 'GET',
    url: `/users/${encodeURIComponent(upn)}?$select=officeLocation`,
  }));

  try {
    const responses = await graphBatch(token, requests, deadline);
    const byId = new Map(responses.map((r) => [r.id, r]));

    upns.forEach((upn, i) => {
      const sub = byId.get(String(i));
      if (!sub) {
        results.set(upn, { outcome: 'retry' });
        return;
      }
      if (sub.status === 404) {
        results.set(upn, { outcome: 'skip' });
        return;
      }
      if (sub.status === 401) {
        invalidateServicePrincipalToken(tenantId);
        results.set(upn, { outcome: 'retry' });
        return;
      }
      // 403 here means the app registration itself lacks User.Read.All - a
      // tenant-wide permission gap, not a per-user transient failure, so
      // retrying every invocation forever would just waste Graph calls
      // hitting the same wall. The caller stops the whole run on this.
      if (sub.status === 403) {
        results.set(upn, { outcome: 'permission_denied' });
        return;
      }
      if (sub.status < 200 || sub.status >= 300) {
        results.set(upn, { outcome: 'retry' });
        return;
      }
      results.set(upn, { outcome: 'captured', officeLocation: sub.body?.officeLocation ?? null });
    });
  } catch (error) {
    const graphError = error as GraphFetchError;
    const budgetExhausted =
      (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) ||
      Date.now() >= deadline;
    if (!budgetExhausted) {
      console.error(`[user-office-location] Batch failed for tenant ${tenantId}:`, graphError);
    }
    for (const upn of upns) results.set(upn, { outcome: 'retry' });
  }

  return results;
}

export async function captureOfficeLocationsForTenant(tenantId: string, budgetMs: number): Promise<void> {
  const token = await getServicePrincipalToken(tenantId);
  if (!token) {
    console.error(`[user-office-location] Failed to get Graph token for tenant ${tenantId}, skipping`);
    return;
  }

  const deadline = Date.now() + budgetMs;
  const sweepDeadline = Math.min(deadline, Date.now() + ID_SWEEP_BUDGET_MS);
  const currentUpns = await fetchDistinctUserPrincipalNames(tenantId, token, sweepDeadline);
  if (currentUpns.length === 0) return;

  const db = getDatabase();

  // Prune cache rows for users no longer the primary user of any device in
  // the tenant's live fleet before computing remaining work.
  await db.userOfficeLocations.pruneRemoved(tenantId, currentUpns);

  const cached = await db.userOfficeLocations.getByTenantId(tenantId);
  const capturedTodaySet = new Set(
    cached.filter((row) => new Date(row.captured_at) >= todayStart()).map((row) => row.user_principal_name)
  );
  const remaining = currentUpns.filter((upn) => !capturedTodaySet.has(upn));
  if (remaining.length === 0) return;

  const chunks: string[][] = [];
  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    chunks.push(remaining.slice(i, i + BATCH_SIZE));
  }

  let buffer: Array<{
    tenant_id: string;
    user_principal_name: string;
    office_location: string | null;
    captured_at: string;
  }> = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    await db.userOfficeLocations.upsertMany(buffer);
    buffer = [];
  };

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    if (Date.now() >= deadline) break;

    const group = chunks.slice(i, i + CONCURRENCY);
    const groupResults = await Promise.all(group.map((chunk) => fetchOfficeLocationsChunk(chunk, token, tenantId, deadline)));

    const now = new Date().toISOString();
    let permissionDenied = false;
    for (const resultMap of groupResults) {
      for (const [upn, result] of resultMap) {
        if (result.outcome === 'captured') {
          buffer.push({ tenant_id: tenantId, user_principal_name: upn, office_location: result.officeLocation, captured_at: now });
        } else if (result.outcome === 'permission_denied') {
          permissionDenied = true;
        }
        // 'skip' and 'retry' write nothing - see OfficeLocationResult doc above.
      }
    }

    if (permissionDenied) {
      console.error(
        `[user-office-location] Tenant ${tenantId}: Graph denied /users/{upn}?$select=officeLocation ` +
          `(403 Authorization_RequestDenied). The app registration needs the "User.Read.All" application ` +
          `permission (admin consent required) for this facet to populate - stopping this run rather than ` +
          `retrying every user against the same permission wall.`
      );
      break;
    }

    if (buffer.length >= PERSIST_CHUNK) {
      await flush();
    }
  }

  await flush();
}

/** Runs office-location capture for every known tenant, capping each
 * tenant's share of overallBudgetMs by whatever time remains so a
 * multi-tenant run can't blow past the caller's total budget. */
export async function captureDueOfficeLocations(overallBudgetMs: number): Promise<void> {
  const db = getDatabase();
  const tenantIds = await db.deviceHealthSnapshots.getKnownTenantIds();
  const overallDeadline = Date.now() + overallBudgetMs;

  for (const tenantId of tenantIds) {
    const remaining = overallDeadline - Date.now();
    if (remaining <= 0) break;

    try {
      await captureOfficeLocationsForTenant(tenantId, remaining);
    } catch (error) {
      console.error(`[user-office-location] Failed for tenant ${tenantId}:`, error);
    }
  }
}
