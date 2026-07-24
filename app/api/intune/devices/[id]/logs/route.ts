/**
 * Device Log Collection API Route
 *
 * Full diagnostic log collection ("Collect diagnostics" in the Intune admin
 * center), backed by Graph's deviceLogCollectionResponse action/resource.
 * Requires DeviceManagementManagedDevices.ReadWrite.All - a permission beyond
 * the read-only scope most of this app's routes use, so a 403 here likely
 * means the tenant hasn't granted/re-consented that permission yet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';

// deviceLogCollectionResponse/createDeviceLogCollectionRequest returned
// "Resource not found for the segment" on v1.0 against a live tenant despite
// Microsoft Learn documenting it as a v1.0 action - same stale-docs pattern
// as deviceAppManagement/.../deviceStatuses elsewhere in this codebase.
// Beta is confirmed working.
const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';
import type {
  DeviceLogCollectionRequest,
  DeviceLogCollectionListResponse,
} from '@/types/devices';

const PERMISSION_ERROR_BODY = {
  error:
    'Missing required permission: DeviceManagementManagedDevices.ReadWrite.All. Please add this permission to your Azure AD app registration and grant admin consent.',
  permissionRequired: 'DeviceManagementManagedDevices.ReadWrite.All',
};

/**
 * Turns a raw Graph error body into a short, user-facing message - never the
 * raw JSON. The full bodyText is always logged server-side separately for
 * debugging; this is only what reaches the client.
 *
 * Diagnostic-log-collection calls go through an Intune backend proxy
 * (StatelessDeviceFEService) that has been observed returning a generic,
 * uninformative "An error has occurred" 403 with an all-zero Operation ID
 * across multiple unrelated devices - that's a known, curated case here
 * rather than Microsoft's own (unhelpful) text.
 */
function toUserFacingMessage(action: string, bodyText: string, statusText: string): string {
  if (bodyText.includes('StatelessDeviceFEService') || bodyText.includes('An error has occurred')) {
    return `Microsoft Intune couldn't ${action} for this device right now (a generic error from Intune's device-action service). This can happen when diagnostic log collection isn't available for this device, or due to a temporary service issue - try again in a few minutes, or try a different device.`;
  }
  return `Failed to ${action}${statusText ? `: ${statusText}` : ''}.`;
}

async function resolveTenant(request: NextRequest, user: { tenantId: string; userId: string }) {
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

    const tenantId = tenantResolution.tenantId;

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

    return { tenantId };
  }

  const hasCachedConsent = await checkStoredConsent(user.tenantId);
  const consentResult = hasCachedConsent
    ? { verified: true }
    : await verifyTenantConsent(user.tenantId);

  if (!consentResult.verified) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Admin consent not found. Please complete the admin consent flow.' },
        { status: 403 }
      ),
    };
  }

  return { tenantId: user.tenantId };
}

/** List past/pending log collection requests for a device. */
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

    const tenantResult = await resolveTenant(request, user);
    if (tenantResult.errorResponse) return tenantResult.errorResponse;
    const tenantId = tenantResult.tenantId!;

    const token = await getServicePrincipalToken(tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const response = await fetch(
      `${GRAPH_API_BASE}/deviceManagement/managedDevices/${encodeURIComponent(id)}/logCollectionRequests`,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error('Error listing device log collection requests:', response.status, bodyText);
      if (response.status === 403 && bodyText.includes('DeviceManagementManagedDevices')) {
        return NextResponse.json(PERMISSION_ERROR_BODY, { status: 403 });
      }
      return NextResponse.json(
        { error: toUserFacingMessage('fetch log collection requests', bodyText, response.statusText) },
        { status: response.status }
      );
    }

    const data: { value?: DeviceLogCollectionRequest[] } = await response.json();

    return NextResponse.json({
      requests: data.value ?? [],
    } as DeviceLogCollectionListResponse);
  } catch (error) {
    console.error('Error in device logs route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch log collection requests' },
      { status: 500 }
    );
  }
}

/** Kick off a new full diagnostic log collection for a device. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const tenantResult = await resolveTenant(request, user);
    if (tenantResult.errorResponse) return tenantResult.errorResponse;
    const tenantId = tenantResult.tenantId!;

    const token = await getServicePrincipalToken(tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const response = await fetch(
      `${GRAPH_API_BASE}/deviceManagement/managedDevices/${encodeURIComponent(id)}/createDeviceLogCollectionRequest`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateType: {
            '@odata.type': 'microsoft.graph.deviceLogCollectionRequest',
            templateType: 'predefined',
          },
        }),
      }
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error('Error creating device log collection request:', response.status, bodyText);
      if (response.status === 403 && bodyText.includes('DeviceManagementManagedDevices')) {
        return NextResponse.json(PERMISSION_ERROR_BODY, { status: 403 });
      }
      return NextResponse.json(
        { error: toUserFacingMessage('start log collection', bodyText, response.statusText) },
        { status: response.status }
      );
    }

    const data: { value?: DeviceLogCollectionRequest } = await response.json();

    return NextResponse.json({ request: data.value ?? data });
  } catch (error) {
    console.error('Error in device logs route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start log collection' },
      { status: 500 }
    );
  }
}
