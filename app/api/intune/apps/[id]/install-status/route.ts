/**
 * Live Intune Install Status API Route
 *
 * On-demand, per-app device install-state summary pulled directly from
 * Microsoft Graph (deviceStatuses), as a live counterpart to IntuneGet's own
 * job-tracking-based Reports charts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { fetchAppInstallStatusSummary, type GraphFetchError } from '@/lib/intune/install-status';
import type { AppInstallStatusResponse } from '@/types/inventory';

export const maxDuration = 60;

// Overall budget for the Graph pagination scan. Must leave headroom under
// maxDuration so a throttled tenant gets partial counts instead of a hang.
const SCAN_BUDGET_MS = 40_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // MSP tenant resolution and the tenant_consent table are Supabase-only
    // (hosted) concerns; self-hosted SQLite installs use the signed-in
    // user's own tenant and verify consent live via Graph.
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

    const token = await getServicePrincipalToken(tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const scanDeadline = Date.now() + SCAN_BUDGET_MS;

    try {
      const result = await fetchAppInstallStatusSummary(id, token, tenantId, scanDeadline);
      return NextResponse.json(result satisfies AppInstallStatusResponse);
    } catch (err) {
      const graphError = err as GraphFetchError;

      if (graphError.status === 404) {
        return NextResponse.json({ error: 'App not found' }, { status: 404 });
      }
      if (graphError.status === 403 && graphError.bodyText?.includes('DeviceManagementApps')) {
        return NextResponse.json(
          {
            error:
              'Missing required permission: DeviceManagementApps.Read.All. Please add this permission to your Azure AD app registration and grant admin consent.',
            permissionRequired: 'DeviceManagementApps.Read.All',
          },
          { status: 403 }
        );
      }
      if (graphError.status === 429) {
        return NextResponse.json(
          {
            error:
              'Microsoft Graph is throttling requests for this tenant. Please wait a minute and try again.',
          },
          { status: 429 }
        );
      }

      console.error('Error fetching app install status:', err);
      return NextResponse.json(
        { error: 'Failed to fetch install status from Intune' },
        { status: graphError.status && graphError.status >= 400 ? graphError.status : 502 }
      );
    }
  } catch (error) {
    console.error('Error in install-status route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch install status' },
      { status: 500 }
    );
  }
}
