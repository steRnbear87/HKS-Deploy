/**
 * ESP Profiles API Route
 * Fetches available Enrollment Status Page profiles from the tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import { acquireGraphToken } from '@/lib/graph-token';
import { listEspProfiles } from '@/lib/esp-api';

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

    let graphToken: string;
    try {
      const tokenResult = await acquireGraphToken(tenantId);
      graphToken = tokenResult.accessToken;
    } catch {
      return NextResponse.json(
        { error: 'Failed to get Graph API token' },
        { status: 500 }
      );
    }

    const profiles = await listEspProfiles(graphToken, tenantId);

    return NextResponse.json({
      profiles,
      count: profiles.length,
    });
  } catch (err) {
    console.error('[ESP Profiles] Error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch ESP profiles' },
      { status: 500 }
    );
  }
}
