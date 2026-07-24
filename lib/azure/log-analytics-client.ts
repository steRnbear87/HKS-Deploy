/**
 * Azure Log Analytics query client, for Windows Update for Business reports.
 *
 * This is a separate Azure resource/auth surface from everything else in this
 * app: instead of a Graph permission, the app's service principal needs the
 * "Log Analytics Reader" Azure RBAC role granted directly on the target
 * workspace (Azure Portal -> workspace -> Access control (IAM)). Same
 * client-credentials flow and app registration as Graph, just a different
 * token audience (`https://api.loganalytics.io/.default`).
 *
 * Callers should treat any failure here as "not configured" rather than a
 * hard error - the workspace may simply not exist yet for this tenant.
 */

import { acquireAppOnlyToken } from '@/lib/azure-app-credential';

const LOG_ANALYTICS_SCOPE = 'https://api.loganalytics.io/.default';
const LOG_ANALYTICS_API_BASE = 'https://api.loganalytics.io/v1';

// Module-scoped token cache, separate from the Graph token cache in
// lib/intune/graph-client.ts since this is a different audience/resource.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getLogAnalyticsToken(tenantId: string): Promise<string | null> {
  const cached = tokenCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now() + 10 * 60 * 1000) {
    return cached.token;
  }

  const result = await acquireAppOnlyToken(tenantId, LOG_ANALYTICS_SCOPE);
  if (!result.ok) {
    tokenCache.delete(tenantId);
    return null;
  }

  tokenCache.set(tenantId, {
    token: result.accessToken,
    expiresAt: Date.now() + result.expiresIn * 1000,
  });
  return result.accessToken;
}

export interface LogAnalyticsColumn {
  name: string;
  type: string;
}

export interface LogAnalyticsTable {
  name: string;
  columns: LogAnalyticsColumn[];
  rows: unknown[][];
}

export type LogAnalyticsQueryResult =
  | { ok: true; tables: LogAnalyticsTable[] }
  | { ok: false; status: number; message: string };

/**
 * Run a KQL query against a Log Analytics workspace. Returns `ok: false`
 * (never throws) on auth failure, missing/misconfigured workspace, or a
 * Graph/Azure-side error - callers should map that to a graceful
 * "not configured" UI state rather than a hard error.
 */
export async function runLogAnalyticsQuery(
  workspaceId: string,
  tenantId: string,
  kql: string
): Promise<LogAnalyticsQueryResult> {
  const token = await getLogAnalyticsToken(tenantId);
  if (!token) {
    return { ok: false, status: 401, message: 'Could not acquire a Log Analytics access token' };
  }

  let response: Response;
  try {
    response = await fetch(`${LOG_ANALYTICS_API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: kql }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      message: err instanceof Error ? err.message : 'Network error querying Log Analytics',
    };
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    return { ok: false, status: response.status, message: bodyText || response.statusText };
  }

  const data: { tables?: LogAnalyticsTable[] } = await response.json();
  return { ok: true, tables: data.tables ?? [] };
}

/** Converts a Log Analytics table into an array of plain row objects keyed by column name. */
export function tableToObjects(table: LogAnalyticsTable): Record<string, unknown>[] {
  return table.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    table.columns.forEach((col, i) => {
      obj[col.name] = row[i];
    });
    return obj;
  });
}
