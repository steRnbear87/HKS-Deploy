/**
 * Device Log Collection Download URL API Route
 * Returns a signed blob URL for a completed diagnostic log collection.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';

// Matches app/api/intune/devices/[id]/logs/route.ts - deviceLogCollectionResponse
// actions need the beta endpoint against a live tenant despite v1.0 docs.
const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';
import type { DeviceLogDownloadUrlResponse } from '@/types/devices';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> }
) {
  try {
    const { id, requestId } = await params;
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

    const token = await getServicePrincipalToken(tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const response = await fetch(
      `${GRAPH_API_BASE}/deviceManagement/managedDevices/${encodeURIComponent(id)}/logCollectionRequests/${encodeURIComponent(requestId)}/createDownloadUrl`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      }
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error('Error creating device log download URL:', bodyText);
      return NextResponse.json(
        { error: 'Failed to create download link' },
        { status: response.status }
      );
    }

    const data: { value?: string } = await response.json();
    if (!data.value) {
      return NextResponse.json({ error: 'No download URL returned' }, { status: 502 });
    }

    return NextResponse.json({ url: data.value } as DeviceLogDownloadUrlResponse);
  } catch (error) {
    console.error('Error in device log download route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create download link' },
      { status: 500 }
    );
  }
}
