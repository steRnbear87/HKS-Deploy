'use client';

/**
 * Renders the pre-existing deployment/Autopilot analytics widgets as report
 * cards - these predate the catalog and already have bespoke visuals + their
 * own data hooks (useAnalytics/useAutopilotReport), so they're re-homed here
 * as-is (see the 'custom: true' registry entries under the Overview
 * category) rather than flattened into the generic bar/pie/table dispatch.
 */

import type { ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { T } from 'gt-next';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useAutopilotReport } from '@/hooks/use-autopilot-report';
import { SuccessRateChart } from './SuccessRateChart';
import { DeploymentsLineChart } from './DeploymentsLineChart';
import { TopAppsChart } from './TopAppsChart';
import { RecentFailuresTable } from './RecentFailuresTable';
import { InstallStatusPanel } from './InstallStatusPanel';
import { AutopilotGroupTagChart } from './AutopilotGroupTagChart';
import { AutopilotFailureReasonsList } from './AutopilotFailureReasonsList';

function AnalyticsLoading() {
  return (
    <div className="flex items-center justify-center py-10 text-text-muted gap-2 text-sm">
      <Loader2 className="w-4 h-4 animate-spin" />
      <T>Loading...</T>
    </div>
  );
}

function AnalyticsError({ message }: { message: string }) {
  return <p className="text-sm text-status-error py-6 text-center">{message}</p>;
}

function DeploymentSuccessRate() {
  const { data, isLoading, error } = useAnalytics(30);
  if (isLoading) return <AnalyticsLoading />;
  if (error) return <AnalyticsError message={error.message} />;
  const summary = data?.summary;
  return (
    <SuccessRateChart
      completed={summary?.completedJobs || 0}
      failed={summary?.failedJobs || 0}
      pending={summary?.pendingJobs || 0}
    />
  );
}

function DeploymentsOverTime() {
  const { data, isLoading, error } = useAnalytics(30);
  if (isLoading) return <AnalyticsLoading />;
  if (error) return <AnalyticsError message={error.message} />;
  return <DeploymentsLineChart data={data?.dailyDeployments || []} />;
}

function MostDeployedApplications() {
  const { data, isLoading, error } = useAnalytics(30);
  if (isLoading) return <AnalyticsLoading />;
  if (error) return <AnalyticsError message={error.message} />;
  return <TopAppsChart data={data?.topApps || []} />;
}

function RecentDeploymentFailures() {
  const { data, isLoading, error } = useAnalytics(30);
  if (isLoading) return <AnalyticsLoading />;
  if (error) return <AnalyticsError message={error.message} />;
  return <RecentFailuresTable data={data?.recentFailures || []} />;
}

function AutopilotGroupTagBreakdown() {
  const { data, isLoading, error } = useAutopilotReport();
  if (isLoading) return <AnalyticsLoading />;
  if (error) return <AnalyticsError message={error instanceof Error ? error.message : 'Failed to load'} />;
  return <AutopilotGroupTagChart groupTags={data?.summary?.groupTags || []} />;
}

function AutopilotFailureReasons() {
  const { data, isLoading, error } = useAutopilotReport();
  if (isLoading) return <AnalyticsLoading />;
  if (error) return <AnalyticsError message={error instanceof Error ? error.message : 'Failed to load'} />;
  const reasons = data?.summary?.failureReasons || [];
  if (reasons.length === 0) {
    return <p className="text-sm text-text-muted py-8 text-center"><T>No Autopilot failures recorded.</T></p>;
  }
  return <AutopilotFailureReasonsList failureReasons={reasons} />;
}

const CUSTOM_REPORT_RENDERERS: Record<string, () => ReactElement> = {
  'deployment-success-rate': DeploymentSuccessRate,
  'deployments-over-time': DeploymentsOverTime,
  'most-deployed-applications': MostDeployedApplications,
  'recent-deployment-failures': RecentDeploymentFailures,
  'live-intune-install-status': InstallStatusPanel,
  'autopilot-group-tag-breakdown': AutopilotGroupTagBreakdown,
  'autopilot-failure-reasons': AutopilotFailureReasons,
};

export function CustomReportBody({ reportId }: { reportId: string }) {
  const Renderer = CUSTOM_REPORT_RENDERERS[reportId];
  if (!Renderer) return null;
  return <Renderer />;
}
