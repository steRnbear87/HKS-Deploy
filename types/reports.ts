/**
 * Report catalog types. Mirrors eido's categorized report-library UX: a flat
 * registry of report definitions (lib/reports/registry.ts) drives the
 * category rail + card grid, and a single dynamic API route
 * (app/api/reports/[reportId]/route.ts) dispatches to a per-report handler
 * by id. Adding a report later is one registry entry + one handler function
 * - no new route files, no new page sections.
 */

export type ReportCategory =
  | 'App Deployment'
  | 'Autopilot'
  | 'Compliance'
  | 'Configuration'
  | 'Device Health'
  | 'Discovered Apps'
  | 'Issues'
  | 'Mobile Devices'
  | 'Overview'
  | 'Patching & OS'
  | 'Policy Management'
  | 'Security'
  | 'Software Metering'
  | 'Users'
  | 'Warranty';

export type ReportChartType = 'bar' | 'pie' | 'table' | 'stat-grid';

export type ReportStatus = 'ready' | 'coming-soon';

export interface ReportDefinition {
  id: string;
  category: ReportCategory;
  title: string;
  description: string;
  chartType: ReportChartType;
  status: ReportStatus;
  /** Shown in the card tooltip for status === 'coming-soon'. */
  comingSoonReason?: string;
  /**
   * When true, this report renders via a hand-built component (registered in
   * components/reports/ReportCatalog.tsx's CUSTOM_REPORT_RENDERERS) instead
   * of fetching /api/reports/[id] through a generic handler - used for
   * pre-existing widgets (deployment analytics, Autopilot breakdowns) that
   * already have bespoke visuals and their own data hooks, so they're
   * re-homed into the catalog as-is rather than flattened into the generic
   * bar/pie/table/stat-grid shape.
   */
  custom?: boolean;
}

interface ReportResultBase {
  generatedAt: string;
  /** Set when the underlying scan hit its time budget - result reflects a partial scan. */
  partial?: boolean;
}

export interface ReportBarPieResult extends ReportResultBase {
  chartType: 'bar' | 'pie';
  data: Array<{ label: string; value: number }>;
}

export interface ReportTableResult extends ReportResultBase {
  chartType: 'table';
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | null>>;
}

export interface ReportStatGridResult extends ReportResultBase {
  chartType: 'stat-grid';
  stats: Array<{ label: string; value: string | number }>;
}

export type ReportResult = ReportBarPieResult | ReportTableResult | ReportStatGridResult;

export type ReportHandler = (tenantId: string) => Promise<ReportResult>;
