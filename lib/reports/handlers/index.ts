import type { ReportHandler } from '@/types/reports';
import { patchingHandlers } from './patching';
import { complianceHandlers } from './compliance';
import { securityHandlers } from './security';
import { deviceHealthHandlers } from './device-health';
import { appDeploymentHandlers } from './app-deployment';
import { autopilotHandlers } from './autopilot';
import { usersHandlers } from './users';

// Merges each category's handler map (see lib/reports/handlers/*.ts) into one
// lookup table. Statically imported and spread here - not a dynamic import
// scan or a side-effecting registration call - so a handler file that exists
// but isn't added to this merge is a visible, obvious gap rather than a
// silent bundler/import-order issue.
const REPORT_HANDLERS: Record<string, ReportHandler> = {
  ...patchingHandlers,
  ...complianceHandlers,
  ...securityHandlers,
  ...deviceHealthHandlers,
  ...appDeploymentHandlers,
  ...autopilotHandlers,
  ...usersHandlers,
};

export function getReportHandler(reportId: string): ReportHandler | undefined {
  return REPORT_HANDLERS[reportId];
}
