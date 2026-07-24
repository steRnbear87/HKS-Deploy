/**
 * Live Intune install-status reporting for a single Win32 app.
 *
 * Pulls `deviceStatuses` for an app straight from Graph (ground truth from
 * Intune) rather than IntuneGet's own packaging-job records, so a device that
 * went offline mid-assignment or failed outside our job lifecycle still shows
 * up. Uses the beta `mobileAppInstallStatus` resource (the same beta surface
 * already used by app/api/intune/apps/[id]/route.ts); Microsoft's docs flag
 * this resource for eventual deprecation in favor of the async
 * deviceManagement/reports job APIs, but it remains functional and is the
 * simplest synchronous per-app source available today.
 */

import { fetchWithRetry, invalidateServicePrincipalToken } from '@/lib/intune/graph-client';
import type { InstallStatusCounts, InstallStatusFailure } from '@/types/inventory';

// deviceStatuses is a beta-only navigation property on mobileApps (v1.0
// returns "Resource not found for the segment"); matches the beta base URL
// already used by app/api/intune/apps/[id]/route.ts for this same app resource.
const GRAPH_API_BASE_BETA = 'https://graph.microsoft.com/beta';

// Cap how many failed-device rows we keep for display; the counts themselves
// still reflect every page scanned.
const MAX_FAILURES = 25;

interface GraphDeviceInstallStatus {
  deviceName?: string | null;
  installState?: string | null;
  errorCode?: number | null;
  lastSyncDateTime?: string | null;
}

export interface GraphFetchError extends Error {
  status: number;
  bodyText: string;
}

export interface AppInstallStatusResult {
  counts: InstallStatusCounts;
  failures: InstallStatusFailure[];
  truncated: boolean;
  partial: boolean;
}

/** Thrown when the scan runs out of its time budget mid-flight. */
export class InstallStatusBudgetExceededError extends Error {
  constructor() {
    super('Install status scan budget exhausted');
    this.name = 'InstallStatusBudgetExceededError';
  }
}

function emptyCounts(): InstallStatusCounts {
  return { installed: 0, failed: 0, pending: 0, notApplicable: 0, unknown: 0, total: 0 };
}

/**
 * Bucket a Graph installState value into one of our five summary buckets.
 * Known values (per the resultantAppState enum): installed, failed,
 * notInstalled, uninstallFailed, pendingInstall, unknown, notApplicable.
 */
function bucketInstallState(installState: string | null | undefined): keyof InstallStatusCounts {
  switch (installState) {
    case 'installed':
      return 'installed';
    case 'failed':
    case 'uninstallFailed':
      return 'failed';
    case 'notInstalled':
    case 'pendingInstall':
      return 'pending';
    case 'notApplicable':
      return 'notApplicable';
    default:
      return 'unknown';
  }
}

/**
 * Fetch and aggregate device install statuses for a single app, following
 * pagination. Bounded by `deadlineAt`: on a throttled tenant with a very
 * large device count, returns partial counts (from whatever pages were
 * scanned) rather than hanging past the caller's own budget.
 */
export async function fetchAppInstallStatusSummary(
  appId: string,
  token: string,
  tenantId: string,
  deadlineAt: number
): Promise<AppInstallStatusResult> {
  const counts = emptyCounts();
  const failures: InstallStatusFailure[] = [];
  let truncated = false;
  let partial = false;

  let nextUrl: string | null =
    `${GRAPH_API_BASE_BETA}/deviceAppManagement/mobileApps/${encodeURIComponent(appId)}/deviceStatuses` +
    `?$select=deviceName,installState,installStateDetail,lastSyncDateTime,errorCode`;

  try {
    while (nextUrl) {
      if (Date.now() >= deadlineAt) {
        throw new InstallStatusBudgetExceededError();
      }

      const response: Response = await fetchWithRetry(
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
        const bodyText = await response.text().catch(() => '');
        const error = new Error(
          `Graph deviceStatuses ${response.status} for app ${appId}`
        ) as GraphFetchError;
        error.status = response.status;
        error.bodyText = bodyText;
        throw error;
      }

      const data: { value?: GraphDeviceInstallStatus[]; '@odata.nextLink'?: string } =
        await response.json();

      for (const row of data.value ?? []) {
        const bucket = bucketInstallState(row.installState);
        counts[bucket] += 1;
        counts.total += 1;

        if (bucket === 'failed') {
          if (failures.length < MAX_FAILURES) {
            failures.push({
              deviceName: row.deviceName || 'Unknown device',
              errorCode: typeof row.errorCode === 'number' ? row.errorCode : null,
              lastSyncDateTime: row.lastSyncDateTime ?? null,
            });
          } else {
            truncated = true;
          }
        }
      }

      nextUrl = data['@odata.nextLink'] || null;
    }
  } catch (err) {
    const budgetExhausted =
      err instanceof InstallStatusBudgetExceededError ||
      (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) ||
      Date.now() >= deadlineAt;

    if (budgetExhausted) {
      partial = true;
    } else {
      throw err;
    }
  }

  return { counts, failures, truncated, partial };
}
