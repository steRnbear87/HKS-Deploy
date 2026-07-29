/**
 * Intune App Details API Route
 * Gets details for a specific Win32 app including assignments
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import { getServicePrincipalToken, invalidateServicePrincipalToken, fetchWithRetry } from '@/lib/intune/graph-client';
import type { IntuneAppWithAssignments, IntuneAppAssignment } from '@/types/inventory';

const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Verify admin consent
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
          { error: 'Admin consent not found' },
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
          { error: 'Admin consent not found' },
          { status: 403 }
        );
      }
    }

    // Get service principal token
    const graphToken = await getServicePrincipalToken(tenantId);

    if (!graphToken) {
      return NextResponse.json(
        { error: 'Failed to get Graph API token' },
        { status: 500 }
      );
    }

    // Fetch app details and assignments in parallel
    const [appResponse, assignmentsResponse] = await Promise.all([
      fetchWithRetry(`${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${id}`, {
        headers: {
          Authorization: `Bearer ${graphToken}`,
          'Content-Type': 'application/json',
        },
      }, 3),
      fetchWithRetry(`${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${id}/assignments`, {
        headers: {
          Authorization: `Bearer ${graphToken}`,
          'Content-Type': 'application/json',
        },
      }, 3),
    ]);

    if (!appResponse.ok) {
      if (appResponse.status === 401) {
        invalidateServicePrincipalToken(tenantId);
      }
      if (appResponse.status === 404) {
        return NextResponse.json(
          { error: 'App not found' },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to fetch app details' },
        { status: appResponse.status }
      );
    }

    const appData = await appResponse.json();
    let assignments: IntuneAppAssignment[] = [];

    if (assignmentsResponse.ok) {
      const assignmentsData = await assignmentsResponse.json();
      assignments = assignmentsData.value || [];
    }

    const app: IntuneAppWithAssignments = {
      ...appData,
      assignments,
    };

    return NextResponse.json({ app });
  } catch (error) {
    console.error('[GET /api/intune/apps/[id]] Unhandled error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch app details' },
      { status: 500 }
    );
  }
}
