/**
 * Fleet-Wide Windows Update Summary API Route
 *
 * Tenant-wide aggregate over Windows Update for Business reports (Azure Log
 * Analytics) - the same workspace/backend as the per-device Windows Update
 * feature, but with no per-device filter. Confirmed empirically that
 * OSQualityUpdateComplianceStatus (and its Feature/Security siblings) report
 * "NotApplicable" for every device on this tenant, so this deliberately does
 * NOT attempt an Installed/Available split - only pendingRestartCount and
 * devicesScanned/asOf carry real signal here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import { runLogAnalyticsQuery, tableToObjects } from '@/lib/azure/log-analytics-client';
import type { FleetWindowsUpdateSummary } from '@/types/devices';

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let tenantId = user.tenantId;
    if (isSupabaseConfigured()) {
      const supabase = createServerClient();
      const mspTenantId = request.headers.get('X-MSP-Tenant-Id');

      const tenantResolution = await resolveTargetTenantId({
        supabase,
        userId: user.userId,
        tokenTenantId: user.tenantId,
        requestedTenantId: mspTenantId,
      });

      if (tenantResolution.errorResponse) {
        return tenantResolution.errorResponse;
      }

      tenantId = tenantResolution.tenantId;

      const { data: consentData, error: consentError } = await supabase
        .from('tenant_consent')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .single();

      if (consentError || !consentData) {
        return NextResponse.json(
          { error: 'Admin consent not found. Please complete the admin consent flow.' },
          { status: 403 }
        );
      }
    } else {
      const hasCachedConsent = await checkStoredConsent(tenantId);
      const consentResult = hasCachedConsent
        ? { verified: true }
        : await verifyTenantConsent(tenantId);

      if (!consentResult.verified) {
        return NextResponse.json(
          { error: 'Admin consent not found. Please complete the admin consent flow.' },
          { status: 403 }
        );
      }
    }

    const workspaceId = process.env.AZURE_LOG_ANALYTICS_WORKSPACE_ID;
    if (!workspaceId) {
      return NextResponse.json({
        configured: false,
        reason: 'No Log Analytics workspace is configured for Windows Update for Business reports.',
      } as FleetWindowsUpdateSummary);
    }

    const [pendingRestartResult, scanResult] = await Promise.all([
      runLogAnalyticsQuery(
        workspaceId,
        tenantId,
        `UCClientUpdateStatus | where TimeGenerated > ago(30d) | summarize arg_max(TimeGenerated, RestartRequiredTime) by AzureADDeviceId | where isnotempty(RestartRequiredTime) | summarize PendingRestartCount = dcount(AzureADDeviceId)`
      ),
      runLogAnalyticsQuery(
        workspaceId,
        tenantId,
        `UCClient | where TimeGenerated > ago(30d) | summarize DevicesScanned = dcount(AzureADDeviceId), AsOf = max(TimeGenerated)`
      ),
    ]);

    if (!pendingRestartResult.ok && !scanResult.ok) {
      const message = !pendingRestartResult.ok ? pendingRestartResult.message : '';
      console.error('Log Analytics query failed for fleet Windows Update summary:', message);
      return NextResponse.json({
        configured: false,
        reason:
          'Could not reach the configured Log Analytics workspace. Confirm the workspace ID and that this app has the Log Analytics Reader role on it.',
      } as FleetWindowsUpdateSummary);
    }

    let pendingRestartCount: number | undefined;
    if (pendingRestartResult.ok && pendingRestartResult.tables[0]?.rows.length) {
      const row = tableToObjects(pendingRestartResult.tables[0])[0];
      pendingRestartCount = (row.PendingRestartCount as number) ?? 0;
    }

    let devicesScanned: number | undefined;
    let asOf: string | null = null;
    if (scanResult.ok && scanResult.tables[0]?.rows.length) {
      const row = tableToObjects(scanResult.tables[0])[0];
      devicesScanned = (row.DevicesScanned as number) ?? 0;
      asOf = (row.AsOf as string) ?? null;
    }

    return NextResponse.json({
      configured: true,
      pendingRestartCount,
      devicesScanned,
      asOf,
    } as FleetWindowsUpdateSummary);
  } catch (error) {
    console.error('Error in fleet windows-updates summary route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch fleet Windows Update summary' },
      { status: 500 }
    );
  }
}
