/**
 * Static report catalog registry - the single source of truth for what
 * appears in the Reports page catalog UI. Adding a report later is one entry
 * here plus one handler function in lib/reports/handlers/ - no new route
 * files, no new page sections.
 *
 * Report titles/categories are modeled on a competitor's (eido) published
 * report catalog. Categories with zero entries below (see CATEGORY_ORDER)
 * are real eido categories we haven't named specific reports for yet - they
 * still render in the rail as empty, ready to receive entries.
 */

import type { ReportCategory, ReportDefinition } from '@/types/reports';

// Matches the category order from eido's own report catalog sidebar.
export const CATEGORY_ORDER: ReportCategory[] = [
  'App Deployment',
  'Autopilot',
  'Compliance',
  'Configuration',
  'Device Health',
  'Discovered Apps',
  'Issues',
  'Mobile Devices',
  'Overview',
  'Patching & OS',
  'Policy Management',
  'Security',
  'Software Metering',
  'Users',
  'Warranty',
];

const NO_CONFIG_SNAPSHOT_REASON =
  "No fleet-wide configuration-profile snapshot exists yet - needs a new per-device capture pipeline, same shape as the BIOS/Autopilot snapshots.";

export const REPORT_REGISTRY: ReportDefinition[] = [
  // --- App Deployment ---
  {
    id: 'app-deployment-issues',
    category: 'App Deployment',
    title: 'App Deployment Issues',
    description: 'Open app deployment issues grouped by app name for drill-down',
    chartType: 'table',
    status: 'ready',
  },
  {
    id: 'app-deployment-open-issues-by-severity',
    category: 'App Deployment',
    title: 'App Deployment Open Issues by Severity',
    description: 'Open app deployment issues grouped by severity',
    chartType: 'pie',
    status: 'ready',
  },
  {
    id: 'high-severity-app-deployment-failures',
    category: 'App Deployment',
    title: 'High Severity App Deployment Failures',
    description: 'Critical open app deployment issues with device details',
    chartType: 'table',
    status: 'ready',
  },

  // --- Autopilot ---
  {
    id: 'autopilot-by-enrollment-method',
    category: 'Autopilot',
    title: 'Autopilot by Enrollment Method',
    description: 'Distribution of enrollment methods used for Autopilot deployments in the last 30 days',
    chartType: 'pie',
    status: 'coming-soon',
    comingSoonReason:
      "Enrollment method isn't exposed on Intune's Autopilot device identity resource - needs the dedicated Autopilot deployment report API.",
  },
  {
    id: 'autopilot-deployment-status',
    category: 'Autopilot',
    title: 'Autopilot Deployment Status',
    description: 'Distribution of Autopilot deployment states over the last 30 days',
    chartType: 'pie',
    status: 'ready',
  },
  {
    id: 'autopilot-deployments-by-os-version',
    category: 'Autopilot',
    title: 'Autopilot Deployments by OS Version',
    description: 'Autopilot deployments grouped by OS version',
    chartType: 'bar',
    status: 'ready',
  },
  {
    id: 'autopilot-deployments-by-profile',
    category: 'Autopilot',
    title: 'Autopilot Deployments by Profile',
    description: 'Deployment count grouped by Autopilot deployment profile',
    chartType: 'bar',
    status: 'coming-soon',
    comingSoonReason:
      "Deployment profile name isn't captured today - needs a new profile-assignment lookup against windowsAutopilotDeploymentProfiles.",
  },
  {
    id: 'autopilot-esp-device-setup-failures',
    category: 'Autopilot',
    title: 'Autopilot ESP Device Setup Failures',
    description: 'Deployments where the Device ESP phase specifically failed in the last 30 days',
    chartType: 'table',
    status: 'coming-soon',
    comingSoonReason:
      "ESP phase-level status isn't available from the Autopilot device identity resource - needs Intune's separate ESP report API.",
  },
  {
    id: 'autopilot-esp-user-setup-failures',
    category: 'Autopilot',
    title: 'Autopilot ESP User Setup Failures',
    description: 'Deployments where the User/Account ESP phase specifically failed in the last 30 days',
    chartType: 'table',
    status: 'coming-soon',
    comingSoonReason:
      "ESP phase-level status isn't available from the Autopilot device identity resource - needs Intune's separate ESP report API.",
  },
  {
    id: 'failed-autopilot-deployments',
    category: 'Autopilot',
    title: 'Failed Autopilot Deployments',
    description: 'Failed Autopilot deployments in the last 30 days',
    chartType: 'table',
    status: 'ready',
  },
  {
    id: 'recent-autopilot-deployments',
    category: 'Autopilot',
    title: 'Recent Autopilot Deployments',
    description: 'Autopilot deployments started in the last 7 days',
    chartType: 'table',
    status: 'ready',
  },
  {
    id: 'slow-autopilot-deployments',
    category: 'Autopilot',
    title: 'Slow Autopilot Deployments',
    description: 'Autopilot deployments taking over 60 minutes total in the last 30 days',
    chartType: 'table',
    status: 'coming-soon',
    comingSoonReason:
      "Deployment duration isn't tracked on the current Autopilot snapshot - needs deployment-timing data from a new report source.",
  },

  // --- Compliance ---
  {
    id: 'compliance-status-breakdown',
    category: 'Compliance',
    title: 'Compliance Status Breakdown',
    description: 'Distribution of compliance statuses across all devices',
    chartType: 'pie',
    status: 'ready',
  },
  {
    id: 'high-severity-compliance-devices',
    category: 'Compliance',
    title: 'High Severity Compliance Devices',
    description: 'Devices with critical compliance failures requiring immediate attention',
    chartType: 'table',
    status: 'ready',
  },
  {
    id: 'non-compliant-byod-devices',
    category: 'Compliance',
    title: 'Non-Compliant BYOD Devices',
    description: 'Personal (BYOD) devices that are not compliant - highest risk combination',
    chartType: 'table',
    status: 'ready',
  },
  {
    id: 'non-compliant-corporate-devices',
    category: 'Compliance',
    title: 'Non-Compliant Corporate Devices',
    description: 'Corporate-owned devices that are not compliant - fully IT-managed and should be addressed',
    chartType: 'table',
    status: 'ready',
  },
  {
    id: 'non-compliant-devices',
    category: 'Compliance',
    title: 'Non-Compliant Devices',
    description: 'All devices currently out of compliance, across ownership types',
    chartType: 'table',
    status: 'ready',
  },

  // --- Configuration ---
  {
    id: 'policy-drift',
    category: 'Configuration',
    title: 'Policy Drift',
    description: "Devices whose configuration profile state has diverged from its intended assignment",
    chartType: 'table',
    status: 'coming-soon',
    comingSoonReason: NO_CONFIG_SNAPSHOT_REASON,
  },
  {
    id: 'config-policies',
    category: 'Configuration',
    title: 'Config Policies',
    description: 'Assigned configuration policies and their status (succeeded, conflict, error)',
    chartType: 'table',
    status: 'coming-soon',
    comingSoonReason: NO_CONFIG_SNAPSHOT_REASON,
  },

  // --- Device Health ---
  {
    id: 'stale-devices',
    category: 'Device Health',
    title: 'Stale Devices',
    description: "Devices that haven't checked in recently",
    chartType: 'table',
    status: 'ready',
  },
  {
    id: 'battery-health-status',
    category: 'Device Health',
    title: 'Battery Health Status',
    description: 'Battery health distribution across the fleet',
    chartType: 'bar',
    status: 'ready',
  },
  {
    id: 'disk-space',
    category: 'Device Health',
    title: 'Disk Space',
    description: 'Free vs. used storage across the fleet',
    chartType: 'bar',
    status: 'ready',
  },

  // --- Overview ---
  // Not eido report titles - these are IntuneGet's own pre-existing
  // deployment/Autopilot analytics widgets, re-homed here (rather than
  // dropped) now that the Reports page is a catalog. Rendered via bespoke
  // components (see components/reports/ReportCatalog.tsx's
  // CUSTOM_REPORT_RENDERERS), not the generic bar/pie/table dispatch.
  {
    id: 'deployment-success-rate',
    category: 'Overview',
    title: 'Deployment Success Rate',
    description: 'Completed vs. failed vs. pending app deployments',
    chartType: 'pie',
    status: 'ready',
    custom: true,
  },
  {
    id: 'deployments-over-time',
    category: 'Overview',
    title: 'Deployments Over Time',
    description: 'Daily completed/failed deployment counts',
    chartType: 'bar',
    status: 'ready',
    custom: true,
  },
  {
    id: 'most-deployed-applications',
    category: 'Overview',
    title: 'Most Deployed Applications',
    description: 'Apps ranked by successful deployment count',
    chartType: 'bar',
    status: 'ready',
    custom: true,
  },
  {
    id: 'recent-deployment-failures',
    category: 'Overview',
    title: 'Recent Deployment Failures',
    description: 'The most recent failed app deployments',
    chartType: 'table',
    status: 'ready',
    custom: true,
  },
  {
    id: 'live-intune-install-status',
    category: 'Overview',
    title: 'Live Intune Install Status',
    description: 'Real device install counts pulled directly from Microsoft Intune, per app',
    chartType: 'table',
    status: 'coming-soon',
    custom: true,
    comingSoonReason:
      'The synchronous Graph endpoint this was built against has been retired - needs the async deviceManagement/reports/exportJobs flow instead.',
  },
  {
    id: 'autopilot-group-tag-breakdown',
    category: 'Overview',
    title: 'Autopilot Group Tag Breakdown',
    description: 'Autopilot devices grouped by their assigned group tag',
    chartType: 'bar',
    status: 'ready',
    custom: true,
  },
  {
    id: 'autopilot-failure-reasons',
    category: 'Overview',
    title: 'Autopilot Failure Reasons',
    description: 'Breakdown of why Autopilot deployments failed',
    chartType: 'table',
    status: 'ready',
    custom: true,
  },

  // --- Security ---
  {
    id: 'encryption-status',
    category: 'Security',
    title: 'Encryption Status',
    description: 'Devices lacking encryption protection',
    chartType: 'pie',
    status: 'ready',
  },

  // --- Patching & OS ---
  {
    id: 'devices-behind-on-patches',
    category: 'Patching & OS',
    title: 'Devices Behind on Patches',
    description: "Devices that haven't installed the latest applicable quality update",
    chartType: 'table',
    status: 'ready',
  },
  {
    id: 'outstanding-patches-by-kb',
    category: 'Patching & OS',
    title: 'Outstanding Patches by KB',
    description: 'Devices grouped by the KB article they are missing',
    chartType: 'bar',
    status: 'ready',
  },
  {
    id: 'os-health',
    category: 'Patching & OS',
    title: 'OS Health',
    description: 'OS version and build health across the fleet',
    chartType: 'stat-grid',
    status: 'ready',
  },
  {
    id: 'os-support-status',
    category: 'Patching & OS',
    title: 'OS Support Status',
    description: 'Devices running a supported vs. end-of-service OS build',
    chartType: 'pie',
    status: 'ready',
  },
  {
    id: 'patches',
    category: 'Patching & OS',
    title: 'Patches',
    description: 'Per-device patch status against the current release catalog',
    chartType: 'table',
    status: 'ready',
  },

  // --- Users ---
  {
    id: 'users-with-non-compliant-devices',
    category: 'Users',
    title: 'Users with Non-Compliant Devices',
    description: 'Users ranked by their count of non-compliant devices',
    chartType: 'table',
    status: 'ready',
  },
  {
    id: 'users-with-patch-issues',
    category: 'Users',
    title: 'Users with Patch Issues',
    description: 'Users whose devices are behind on patching',
    chartType: 'table',
    status: 'ready',
  },
  {
    id: 'users-with-app-deployment-issues',
    category: 'Users',
    title: 'Users with App Deployment Issues',
    description: 'Users affected by app deployment failures',
    chartType: 'table',
    status: 'coming-soon',
    comingSoonReason:
      "Our packaging-job records track the admin who ran the job, not the end-user whose device the app deploys to - no per-device install failure is attributed to an end-user anywhere yet, so this can't be built without a new fleet-wide per-app install-status snapshot.",
  },
  {
    id: 'users-with-configuration-issues',
    category: 'Users',
    title: 'Users with Configuration Issues',
    description: 'Users affected by configuration profile failures',
    chartType: 'table',
    status: 'coming-soon',
    comingSoonReason: NO_CONFIG_SNAPSHOT_REASON,
  },
];

export function getReportsByCategory(): Map<ReportCategory, ReportDefinition[]> {
  const map = new Map<ReportCategory, ReportDefinition[]>(CATEGORY_ORDER.map((c) => [c, []]));
  for (const report of REPORT_REGISTRY) {
    map.get(report.category)?.push(report);
  }
  return map;
}

export function getReportDefinition(id: string): ReportDefinition | undefined {
  return REPORT_REGISTRY.find((r) => r.id === id);
}
