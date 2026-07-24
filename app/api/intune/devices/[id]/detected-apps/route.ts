/**
 * Device Installed-App Inventory API Route
 *
 * Backed by Graph's `detectedApps` nav property on `managedDevices/{id}`.
 * Confirmed via direct curl testing against the live tenant: 404s on v1.0
 * ("Resource not found for the segment 'detectedApps'"), works on beta with
 * real data - same stale-docs/version-gap pattern as elsewhere in this
 * codebase (hardwareInformation, deviceLogCollectionResponse).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import type { DetectedApp, DeviceAppInventoryResponse } from '@/types/devices';

const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

// detectedApps includes OS hotfixes/components alongside user-facing
// software - a single device can legitimately report hundreds of rows
// (382 observed on a real test device), so this is a defensive cap, not an
// expected ceiling.
const MAX_APPS = 500;

function toUserFacingMessage(bodyText: string, statusText: string): string {
  if (bodyText.includes('StatelessDeviceFEService') || bodyText.includes('An error has occurred')) {
    return "Microsoft Intune couldn't load installed apps for this device right now (a generic error from Intune's device-action service). Try again in a few minutes, or try a different device.";
  }
  return `Failed to load installed apps${statusText ? `: ${statusText}` : ''}.`;
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

    const apps: DetectedApp[] = [];
    let truncated = false;
    let nextUrl: string | null =
      `${GRAPH_API_BASE}/deviceManagement/managedDevices/${encodeURIComponent(id)}/detectedApps` +
      `?$select=id,displayName,version,publisher`;

    while (nextUrl && apps.length < MAX_APPS) {
      const response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return NextResponse.json({ error: 'Device not found' }, { status: 404 });
        }
        const bodyText = await response.text().catch(() => '');
        console.error('Error fetching detected apps:', response.status, bodyText);
        if (response.status === 403 && bodyText.includes('DeviceManagementManagedDevices')) {
          return NextResponse.json({
            configured: false,
            reason: 'Missing required permission: DeviceManagementManagedDevices.Read.All.',
            permissionRequired: 'DeviceManagementManagedDevices.Read.All',
          } as DeviceAppInventoryResponse);
        }
        return NextResponse.json(
          { error: toUserFacingMessage(bodyText, response.statusText) },
          { status: response.status }
        );
      }

      const data: { value?: DetectedApp[]; '@odata.nextLink'?: string } = await response.json();
      apps.push(...(data.value ?? []));
      nextUrl = data['@odata.nextLink'] ?? null;

      if (apps.length >= MAX_APPS) {
        truncated = true;
        break;
      }
    }

    apps.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return NextResponse.json({
      configured: true,
      apps,
      total: apps.length,
      truncated,
    } as DeviceAppInventoryResponse);
  } catch (error) {
    console.error('Error in device detected-apps route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch installed apps' },
      { status: 500 }
    );
  }
}
