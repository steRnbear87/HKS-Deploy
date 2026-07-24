/**
 * Intune Apps Updates API Route
 * Identifies apps with available Winget updates
 * Uses curated_apps table (Supabase, or the local SQLite snapshot in
 * self-hosted mode) for fast version lookups.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { parseAccessToken } from '@/lib/auth-utils';
import { fetchTenantAppInventory, computeUserAppUpdates, GraphInventoryError } from '@/lib/intune/live-app-updates';

// Extend timeout for Vercel (Pro plan: up to 60s)
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    let tenantId = user.tenantId;
    const supabase = isSupabaseConfigured() ? createServerClient() : null;

    if (supabase) {
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
          { error: 'Admin consent not found. Please complete the admin consent flow.' },
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

    const inventory = await fetchTenantAppInventory(supabase, tenantId, graphToken);
    const { updates, checked, totalApps } = await computeUserAppUpdates({
      userId: user.userId,
      tenantId,
      inventory,
    });

    return NextResponse.json({
      updates,
      updateCount: updates.length,
      totalApps,
      checkedApps: checked,
    });
  } catch (error) {
    if (error instanceof GraphInventoryError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { error: 'Failed to check for updates' },
      { status: 500 }
    );
  }
}
