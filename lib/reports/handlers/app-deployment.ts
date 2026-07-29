/**
 * App Deployment report handlers - built on the existing packaging jobs
 * table (lib/db/types.ts PackagingJob), same tenant-wide read
 * (db.jobs.getByTenantId) and aggregation-by-app shape already used for
 * "topApps" in app/api/analytics/route.ts. Severity is NOT a real Intune/job
 * concept - PackagingJob has no severity field - so it's approximated here
 * from error_category via SEVERITY_BY_CATEGORY, documented as a judgment
 * call rather than a real Graph/Intune severity taxonomy.
 */

import { getDatabase } from '@/lib/db';
import type { ReportHandler } from '@/types/reports';
import type { PackagingJob } from '@/lib/db/types';

const SCAN_LIMIT = 2000;

type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

// Best-effort keyword bucketing over the free-text error_category field -
// there's no fixed enum for it in this codebase (jobs write whatever string
// fits at the failure site, e.g. 'network', 'system', 'intune_api').
function severityForCategory(errorCategory: string | null | undefined): Severity {
  const category = (errorCategory || '').toLowerCase();
  if (category.includes('system') || category.includes('rce') || category.includes('security')) return 'Critical';
  if (category.includes('intune') || category.includes('auth') || category.includes('permission')) return 'High';
  if (category.includes('network') || category.includes('timeout')) return 'Medium';
  return 'Low';
}

async function loadFailedJobs(tenantId: string): Promise<PackagingJob[]> {
  const jobs = await getDatabase().jobs.getByTenantId(tenantId, SCAN_LIMIT);
  return jobs.filter((j) => j.status === 'failed' && !j.archived_at);
}

export const appDeploymentIssues: ReportHandler = async (tenantId) => {
  const failed = await loadFailedJobs(tenantId);

  const byApp = new Map<string, { displayName: string; publisher: string; count: number; latestError: string }>();
  for (const job of failed) {
    const existing = byApp.get(job.winget_id);
    if (existing) {
      existing.count++;
    } else {
      byApp.set(job.winget_id, {
        displayName: job.display_name,
        publisher: job.publisher || 'Unknown',
        count: 1,
        latestError: job.error_message || 'Unknown error',
      });
    }
  }

  const columns = [
    { key: 'app', label: 'App' },
    { key: 'publisher', label: 'Publisher' },
    { key: 'count', label: 'Failed Count' },
    { key: 'latestError', label: 'Latest Error' },
  ];
  const rows = Array.from(byApp.values())
    .sort((a, b) => b.count - a.count)
    .map((v) => ({ app: v.displayName, publisher: v.publisher, count: v.count, latestError: v.latestError }));

  return { chartType: 'table', columns, rows, generatedAt: new Date().toISOString() };
};

export const appDeploymentOpenIssuesBySeverity: ReportHandler = async (tenantId) => {
  const failed = await loadFailedJobs(tenantId);

  const counts = new Map<Severity, number>();
  for (const job of failed) {
    const severity = severityForCategory(job.error_category);
    counts.set(severity, (counts.get(severity) ?? 0) + 1);
  }

  const order: Severity[] = ['Critical', 'High', 'Medium', 'Low'];
  const data = order.filter((s) => counts.has(s)).map((label) => ({ label, value: counts.get(label) as number }));

  return { chartType: 'pie', data, generatedAt: new Date().toISOString() };
};

export const highSeverityAppDeploymentFailures: ReportHandler = async (tenantId) => {
  const failed = await loadFailedJobs(tenantId);
  const critical = failed.filter((j) => severityForCategory(j.error_category) === 'Critical');

  const columns = [
    { key: 'app', label: 'App' },
    { key: 'errorMessage', label: 'Error' },
    { key: 'errorCategory', label: 'Category' },
    { key: 'date', label: 'Date' },
  ];
  const rows = critical
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50)
    .map((job) => ({
      app: job.display_name,
      errorMessage: job.error_message || 'Unknown error',
      errorCategory: job.error_category || 'Unclassified',
      date: new Date(job.created_at).toLocaleString(),
    }));

  return { chartType: 'table', columns, rows, generatedAt: new Date().toISOString() };
};

export const appDeploymentHandlers: Record<string, ReportHandler> = {
  'app-deployment-issues': appDeploymentIssues,
  'app-deployment-open-issues-by-severity': appDeploymentOpenIssuesBySeverity,
  'high-severity-app-deployment-failures': highSeverityAppDeploymentFailures,
};
