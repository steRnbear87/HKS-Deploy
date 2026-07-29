/**
 * Report catalog dispatch route. One dynamic route for every report in
 * lib/reports/registry.ts - the handler for a given reportId is looked up
 * from lib/reports/handlers/index.ts rather than each report getting its own
 * route file. Unknown ids and ids without a wired handler yet (registry
 * status 'coming-soon', or a 'ready' report whose handler hasn't landed)
 * both 404 - the frontend (ReportRunner) shows a graceful empty state either
 * way, so there's no unsafe window while reports are being built out.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import { getReportDefinition } from '@/lib/reports/registry';
import { getReportHandler } from '@/lib/reports/handlers';

export async function GET(request: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const { reportId } = await params;

    const definition = getReportDefinition(reportId);
    if (!definition) {
      return NextResponse.json({ error: 'Unknown report' }, { status: 404 });
    }

    const handler = getReportHandler(reportId);
    if (!handler) {
      return NextResponse.json({ error: 'Report not available yet' }, { status: 404 });
    }

    const tenantResult = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in tenantResult) {
      return tenantResult.errorResponse;
    }

    const result = await handler(tenantResult.tenantId);
    return NextResponse.json(result);
  } catch (error) {
    console.error(`Error running report:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run report' },
      { status: 500 }
    );
  }
}
