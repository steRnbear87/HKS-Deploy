/**
 * Windows Autopilot device identity snapshot capture.
 *
 * Graph's deviceManagement/windowsAutopilotDeviceIdentities is a single
 * paginated tenant-wide collection - no per-device fan-out needed, unlike
 * BIOS (lib/device-health/bios-snapshot.ts) which requires one Graph call
 * per device since hardwareInformation is only populated on single-device
 * fetches. Each row already carries live enrollment/deployment-profile
 * status, so this is a current-state cache (like device_bios_info), not a
 * daily-accumulating rollup: every capture replaces what's currently known
 * about the tenant's Autopilot device population.
 *
 * deploymentProfileAssignmentStatus/deploymentProfileAssignmentDetailedStatus
 * are beta-only fields - confirmed empirically against a live tenant: v1.0
 * returns "Could not find a property named 'deploymentProfileAssignmentStatus'
 * on type 'microsoft.graph.windowsAutopilotDeviceIdentity'" for the exact
 * same $select, while beta returns it populated (e.g. "notAssigned"). Same
 * v1.0-lacks-it, beta-has-it pattern as hardwareInformation/detectedApps
 * elsewhere in this codebase.
 */

import { getDatabase } from '@/lib/db';
import {
  fetchWithRetry,
  getServicePrincipalToken,
  invalidateServicePrincipalToken,
} from '@/lib/intune/graph-client';
import type { AutopilotDeviceSnapshotRecord } from '@/lib/db/types';
import type {
  AutopilotEnrollmentState,
  AutopilotDeploymentProfileAssignmentStatus,
  AutopilotSummary,
  AutopilotFunnelCounts,
} from '@/types/autopilot';

// windowsAutopilotDeviceIdentities' deployment-profile fields are beta-only
// (see file docblock) - same beta base used by bios-snapshot.ts/
// app-inventory-snapshot.ts for their own beta-only fields.
const GRAPH_API_BASE_BETA = 'https://graph.microsoft.com/beta';

const SCAN_BUDGET_MS = 40_000;

interface RawAutopilotDeviceIdentity {
  id: string;
  serialNumber?: string | null;
  groupTag?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  enrollmentState?: string | null;
  deploymentProfileAssignmentStatus?: string | null;
  lastContactedDateTime?: string | null;
}

const KNOWN_ENROLLMENT_STATES: ReadonlySet<string> = new Set([
  'unknown',
  'enrolled',
  'pending',
  'failed',
  'notContacted',
]);

const KNOWN_DEPLOYMENT_STATUSES: ReadonlySet<string> = new Set([
  'unknown',
  'assignedInSync',
  'assignedOutOfSync',
  'assignedUnkownSyncState',
  'notAssigned',
  'pending',
  'failed',
]);

// Graph's enum values are stable but not exhaustively documented - fail
// closed to 'unknown' for anything unrecognized rather than letting a new
// enum member silently break downstream funnel/failure-reason grouping.
function normalizeEnrollmentState(value: string | null | undefined): AutopilotEnrollmentState {
  return (value && KNOWN_ENROLLMENT_STATES.has(value) ? value : 'unknown') as AutopilotEnrollmentState;
}

function normalizeDeploymentStatus(value: string | null | undefined): AutopilotDeploymentProfileAssignmentStatus {
  return (value && KNOWN_DEPLOYMENT_STATUSES.has(value)
    ? value
    : 'unknown') as AutopilotDeploymentProfileAssignmentStatus;
}

/**
 * One paginated sweep of the tenant's Autopilot device identities. Returns
 * whatever was fetched before the deadline or a failure - partial results
 * are still useful (the cron job resumes next tick), never thrown away.
 */
async function fetchAutopilotDevices(
  tenantId: string,
  token: string,
  deadline: number
): Promise<{ devices: RawAutopilotDeviceIdentity[]; partial: boolean }> {
  const devices: RawAutopilotDeviceIdentity[] = [];
  let partial = false;
  // No $select - confirmed empirically that this exact endpoint's backend
  // (StatelessDeviceEnrollmentFEService) returns a deterministic 500 for
  // this particular field combination (reproduced 5/5 attempts), while the
  // unfiltered request succeeds every time. Same "generic backend proxy
  // misbehaves" pattern already documented for log-collection requests
  // elsewhere in this codebase - fetch full objects and pick fields in code.
  let nextUrl: string | null = `${GRAPH_API_BASE_BETA}/deviceManagement/windowsAutopilotDeviceIdentities`;

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
      const bodyText = await response.text().catch(() => '');
      console.error(
        `[autopilot-snapshot] Graph windowsAutopilotDeviceIdentities ${response.status} for tenant ${tenantId}:`,
        bodyText
      );
      partial = true;
      break;
    }

    const data: { value?: RawAutopilotDeviceIdentity[]; '@odata.nextLink'?: string } = await response.json();
    if (Array.isArray(data.value)) devices.push(...data.value);
    nextUrl = data['@odata.nextLink'] ?? null;
  }

  return { devices, partial };
}

export async function captureAutopilotSnapshotForTenant(tenantId: string, budgetMs: number): Promise<void> {
  const token = await getServicePrincipalToken(tenantId);
  if (!token) {
    console.error(`[autopilot-snapshot] Failed to get Graph token for tenant ${tenantId}, skipping`);
    return;
  }

  const deadline = Date.now() + budgetMs;
  const { devices, partial } = await fetchAutopilotDevices(tenantId, token, deadline);

  // Nothing captured and the sweep didn't even finish the first page - don't
  // touch existing data (including pruning) on a fully-failed attempt.
  if (devices.length === 0 && partial) return;

  const db = getDatabase();
  const capturedAt = new Date().toISOString();
  const rows = devices.map((d) => ({
    tenant_id: tenantId,
    device_id: d.id,
    serial_number: d.serialNumber || null,
    // Graph returns groupTag as an empty string, not null, when unset -
    // normalize to null so downstream "(none)" grouping is a single check.
    group_tag: d.groupTag || null,
    manufacturer: d.manufacturer || null,
    model: d.model || null,
    enrollment_state: normalizeEnrollmentState(d.enrollmentState),
    deployment_profile_assignment_status: normalizeDeploymentStatus(d.deploymentProfileAssignmentStatus),
    last_contacted_at: d.lastContactedDateTime || null,
    captured_at: capturedAt,
  }));

  await db.autopilotDeviceSnapshots.upsertMany(rows);

  // Only prune devices no longer present when the sweep actually completed -
  // a partial sweep (budget cutoff or a transient Graph failure mid-page)
  // must never be read as "these devices were deregistered".
  if (!partial) {
    await db.autopilotDeviceSnapshots.pruneRemoved(
      tenantId,
      devices.map((d) => d.id)
    );
  }
}

/**
 * Runs Autopilot snapshot capture for every known tenant, capping each
 * tenant's share of overallBudgetMs by whatever time remains so a
 * multi-tenant run can't blow past the caller's total budget.
 */
export async function captureDueAutopilotSnapshots(overallBudgetMs: number): Promise<void> {
  const db = getDatabase();
  const tenantIds = await db.deviceHealthSnapshots.getKnownTenantIds();
  const overallDeadline = Date.now() + overallBudgetMs;

  for (const tenantId of tenantIds) {
    const remaining = overallDeadline - Date.now();
    if (remaining <= 0) break;

    try {
      await captureAutopilotSnapshotForTenant(tenantId, Math.min(remaining, SCAN_BUDGET_MS));
    } catch (error) {
      console.error(`[autopilot-snapshot] Failed for tenant ${tenantId}:`, error);
    }
  }
}

/**
 * Builds the report summary (funnel, group-tag breakdown, failure reasons)
 * from cached snapshot rows. Pure function so the API route and any test
 * can exercise it without touching the database.
 */
export function buildAutopilotSummary(rows: AutopilotDeviceSnapshotRecord[]): AutopilotSummary {
  const funnel: AutopilotFunnelCounts = { registered: rows.length, profileAssigned: 0, enrolled: 0, failed: 0 };
  const groupTagCounts = new Map<string, number>();
  const failureReasonCounts = new Map<AutopilotDeploymentProfileAssignmentStatus, number>();
  let latestCapturedAt: string | null = null;

  for (const row of rows) {
    const enrollmentState = row.enrollment_state as AutopilotEnrollmentState;
    const deploymentStatus = row.deployment_profile_assignment_status as AutopilotDeploymentProfileAssignmentStatus;

    // A profile is considered assigned for all three "assigned*" states -
    // confirmed against real tenant data that assignedUnkownSyncState (sic;
    // that's Graph's actual spelling) is the common case, not an edge case:
    // it means a profile IS assigned, just with unconfirmed sync freshness,
    // not "not yet assigned". Excluding it would make the funnel's
    // "Profile Assigned" count wrongly near-zero for real tenants.
    if (
      deploymentStatus === 'assignedInSync' ||
      deploymentStatus === 'assignedOutOfSync' ||
      deploymentStatus === 'assignedUnkownSyncState'
    ) {
      funnel.profileAssigned++;
    }
    if (enrollmentState === 'enrolled') {
      funnel.enrolled++;
    }
    if (enrollmentState === 'failed' || deploymentStatus === 'failed') {
      funnel.failed++;
      failureReasonCounts.set(deploymentStatus, (failureReasonCounts.get(deploymentStatus) ?? 0) + 1);
    }

    const tag = row.group_tag || '(none)';
    groupTagCounts.set(tag, (groupTagCounts.get(tag) ?? 0) + 1);

    if (!latestCapturedAt || row.captured_at > latestCapturedAt) {
      latestCapturedAt = row.captured_at;
    }
  }

  return {
    funnel,
    groupTags: Array.from(groupTagCounts.entries())
      .map(([groupTag, count]) => ({ groupTag, count }))
      .sort((a, b) => b.count - a.count),
    failureReasons: Array.from(failureReasonCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    totalDevices: rows.length,
    capturedAt: latestCapturedAt,
  };
}
