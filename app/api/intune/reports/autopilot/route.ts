/**
 * Windows Autopilot Reporting API Route
 *
 * Reads the autopilot_device_snapshots cache (populated by the background
 * snapshot job - see lib/intune-reports/autopilot.ts) rather than calling
 * Graph live, so this route is fast and never blocked on Graph throttling.
 * `configured: true` with an all-zero summary is a valid response - it means
 * either no Autopilot devices are registered for this tenant, or the
 * snapshot job hasn't completed a first sweep yet; it does NOT by itself
 * mean the required Graph permission is missing (that's tracked separately
 * via /api/auth/verify-consent, since this route never calls Graph and so
 * has no live signal to distinguish the two).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import { getDatabase } from '@/lib/db';
import { buildAutopilotSummary } from '@/lib/intune-reports/autopilot';
import type { AutopilotReportResponse } from '@/types/autopilot';

export async function GET(request: NextRequest) {
  try {
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

    const rows = await getDatabase().autopilotDeviceSnapshots.getByTenantId(tenantId);
    const summary = buildAutopilotSummary(rows);

    return NextResponse.json({
      configured: true,
      summary,
    } as AutopilotReportResponse);
  } catch (error) {
    console.error('Error in Autopilot report route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch Autopilot report' },
      { status: 500 }
    );
  }
}
