/**
 * Device Windows Update Status API Route
 *
 * Backed by Windows Update for Business reports (Azure Log Analytics), not
 * Graph - Graph has no per-device Windows Update data beyond coarse ring
 * compliance. This is a genuinely optional feature: if the tenant hasn't
 * enrolled a Log Analytics workspace into WUfB reports (a manual Azure/M365
 * admin process, not something this app can do), this returns
 * `{ configured: false }` rather than an error so the UI can show a clear
 * "not set up" state instead of a broken one.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import { runLogAnalyticsQuery, tableToObjects } from '@/lib/azure/log-analytics-client';
import type {
  WindowsUpdateDeviceSummary,
  WindowsUpdateEvent,
  WindowsUpdatesResponse,
} from '@/types/devices';

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_EVENTS = 50;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params; // device id isn't used directly - Log Analytics is keyed by azureADDeviceId

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
      } as WindowsUpdatesResponse);
    }

    const azureADDeviceId = request.nextUrl.searchParams.get('azureADDeviceId');
    if (!azureADDeviceId || !GUID_PATTERN.test(azureADDeviceId)) {
      return NextResponse.json({
        configured: false,
        reason: 'This device has no Microsoft Entra device ID on record, so it cannot be matched to Windows Update for Business reports.',
      } as WindowsUpdatesResponse);
    }

    const [summaryResult, eventsResult] = await Promise.all([
      runLogAnalyticsQuery(
        workspaceId,
        tenantId,
        `UCClient | where AzureADDeviceId == '${azureADDeviceId}' | top 1 by TimeGenerated desc`
      ),
      runLogAnalyticsQuery(
        workspaceId,
        tenantId,
        `UCClientUpdateStatus | where AzureADDeviceId == '${azureADDeviceId}' | order by TimeGenerated desc | take ${MAX_EVENTS}`
      ),
    ]);

    if (!summaryResult.ok && !eventsResult.ok) {
      const message = !summaryResult.ok ? summaryResult.message : '';
      console.error('Log Analytics query failed for Windows Update status:', message);
      return NextResponse.json({
        configured: false,
        reason:
          'Could not reach the configured Log Analytics workspace. Confirm the workspace ID and that this app has the Log Analytics Reader role on it.',
      } as WindowsUpdatesResponse);
    }

    let summary: WindowsUpdateDeviceSummary | null = null;
    if (summaryResult.ok && summaryResult.tables[0]?.rows.length) {
      const row = tableToObjects(summaryResult.tables[0])[0];
      summary = {
        osBuild: (row.OSBuild as string) ?? null,
        osVersion: (row.OSVersion as string) ?? null,
        featureUpdateComplianceStatus: (row.OSFeatureUpdateComplianceStatus as string) ?? null,
        qualityUpdateComplianceStatus: (row.OSQualityUpdateComplianceStatus as string) ?? null,
        securityUpdateComplianceStatus: (row.OSSecurityUpdateComplianceStatus as string) ?? null,
        qualityUpdateStatus: (row.OSQualityUpdateStatus as string) ?? null,
        securityUpdateStatus: (row.OSSecurityUpdateStatus as string) ?? null,
        lastWuScanTime: (row['LastWUScanTime [UTC]'] as string) ?? null,
      };
    }

    let events: WindowsUpdateEvent[] = [];
    if (eventsResult.ok) {
      events = tableToObjects(eventsResult.tables[0] ?? { name: '', columns: [], rows: [] }).map(
        (row) => ({
          updateDisplayName: (row.UpdateDisplayName as string) ?? null,
          kbNumber: (row.TargetKBNumber as string) ?? null,
          category: (row.UpdateCategory as string) ?? null,
          classification: (row.UpdateClassification as string) ?? null,
          clientSubstate: (row.ClientSubstate as string) ?? null,
          furthestClientSubstate: (row.FurthestClientSubstate as string) ?? null,
          updateInstalledTime: (row['UpdateInstalledTime [UTC]'] as string) ?? null,
          restartRequiredTime: (row['RestartRequiredTime [UTC]'] as string) ?? null,
          timeGenerated: (row['TimeGenerated [UTC]'] as string) ?? null,
        })
      );
    }

    // Best-effort "reboot pending" signal: events are already ordered by
    // TimeGenerated desc, so the most recent one with a RestartRequiredTime
    // is the freshest report of a pending restart. Not authoritative - WUfB
    // reports refresh once every 24h, so this reflects "as of last scan".
    const mostRecentWithRestart = events.find((e) => e.restartRequiredTime);
    const pendingReboot = !!mostRecentWithRestart;
    const rebootRequiredSince = mostRecentWithRestart?.restartRequiredTime ?? null;

    return NextResponse.json({
      configured: true,
      summary,
      events,
      pendingReboot,
      rebootRequiredSince,
    } as WindowsUpdatesResponse);
  } catch (error) {
    console.error('Error in device windows-updates route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch Windows Update status' },
      { status: 500 }
    );
  }
}
