/**
 * Shared auth/tenant-resolution boilerplate for the Windows Update management
 * API routes. Every route under app/api/intune/windows-updates/* needs the
 * identical authenticate -> resolve tenant -> verify consent sequence (the
 * same block duplicated inline in devices/route.ts, groups/route.ts, etc.
 * elsewhere in this codebase) - extracted here since this feature adds many
 * routes needing it, unlike the one-off routes it's copied inline in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';

export async function resolveAuthenticatedTenant(
  request: NextRequest
): Promise<{ tenantId: string } | { errorResponse: NextResponse }> {
  const user = await parseAccessToken(request.headers.get('Authorization'));
  if (!user) {
    return { errorResponse: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
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
      return { errorResponse: tenantResolution.errorResponse };
    }

    tenantId = tenantResolution.tenantId;

    const { data: consentData, error: consentError } = await supabase
      .from('tenant_consent')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    if (consentError || !consentData) {
      return {
        errorResponse: NextResponse.json(
          { error: 'Admin consent not found. Please complete the admin consent flow.' },
          { status: 403 }
        ),
      };
    }
  } else {
    const hasCachedConsent = await checkStoredConsent(tenantId);
    const consentResult = hasCachedConsent ? { verified: true } : await verifyTenantConsent(tenantId);

    if (!consentResult.verified) {
      return {
        errorResponse: NextResponse.json(
          { error: 'Admin consent not found. Please complete the admin consent flow.' },
          { status: 403 }
        ),
      };
    }
  }

  return { tenantId };
}
