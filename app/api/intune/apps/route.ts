/**
 * Intune Apps API Route
 * Lists all Win32 apps from the user's Intune tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import { fetchWithRetry, getServicePrincipalToken, invalidateServicePrincipalToken } from '@/lib/intune/graph-client';
import type { IntuneWin32App } from '@/types/inventory';

const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

export const maxDuration = 60;

// Overall budget for the Graph pagination scan. Must leave headroom under
// maxDuration so a throttled tenant gets a partial list instead of a hang -
// mirrors app/api/intune/devices/route.ts's SCAN_BUDGET_MS.
const SCAN_BUDGET_MS = 40_000;

interface GraphFetchError extends Error {
  status: number;
  bodyText: string;
}

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
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

    // Get the service principal token to call Graph API
    const graphToken = await getServicePrincipalToken(tenantId);

    if (!graphToken) {
      return NextResponse.json(
        { error: 'Failed to get Graph API token' },
        { status: 500 }
      );
    }

    // Fetch Win32 apps from Graph API with pagination support
    // Note: We can't use $select with derived type fields when using isof filter
    // So we fetch all fields and let Graph API return the full win32LobApp objects
    const apps: IntuneWin32App[] = [];
    let partial = false;

    const scanDeadline = Date.now() + SCAN_BUDGET_MS;
    let nextUrl: string | null = `${GRAPH_API_BASE}/deviceAppManagement/mobileApps?$filter=isof('microsoft.graph.win32LobApp')&$orderby=displayName&$top=100`;

    try {
      while (nextUrl) {
        if (Date.now() >= scanDeadline) {
          partial = true;
          break;
        }

        const graphResponse: Response = await fetchWithRetry(
          nextUrl,
          {
            headers: {
              Authorization: `Bearer ${graphToken}`,
              'Content-Type': 'application/json',
            },
          },
          3,
          scanDeadline
        );

        if (!graphResponse.ok) {
          if (graphResponse.status === 401) {
            invalidateServicePrincipalToken(tenantId);
          }
          const bodyText = await graphResponse.text().catch(() => '');
          const error = new Error(`Graph mobileApps ${graphResponse.status}`) as GraphFetchError;
          error.status = graphResponse.status;
          error.bodyText = bodyText;
          throw error;
        }

        const graphData = await graphResponse.json();
        const pageApps: IntuneWin32App[] = graphData.value || [];
        apps.push(...pageApps);

        // Check for next page
        nextUrl = graphData['@odata.nextLink'] || null;
      }
    } catch (err) {
      const graphError = err as GraphFetchError;
      const budgetExhausted =
        (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) ||
        Date.now() >= scanDeadline;

      if (budgetExhausted) {
        partial = true;
      } else {
        if (graphError.status === 429) {
          return NextResponse.json(
            {
              error: 'Microsoft Graph is throttling requests for this tenant. Please wait a minute and try again.',
            },
            { status: 429 }
          );
        }
        console.error('Error fetching Intune apps:', err);
        return NextResponse.json(
          { error: 'Failed to fetch apps from Intune' },
          { status: graphError.status && graphError.status >= 400 ? graphError.status : 502 }
        );
      }
    }

    return NextResponse.json({
      apps,
      count: apps.length,
      partial,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch Intune apps' },
      { status: 500 }
    );
  }
}
