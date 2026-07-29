/**
 * Device Remote Actions API Route
 *
 * Simple remote actions (sync, reboot, shutdown, Company Portal notification)
 * from the Intune admin center's device action bar, backed directly by
 * Graph's managedDevices/{id}/<action> endpoints. Deliberately excludes
 * destructive actions (remote lock, retire, wipe) - those need a much
 * stronger confirmation flow than a single POST route and weren't asked for.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import { getServicePrincipalToken, invalidateServicePrincipalToken } from '@/lib/intune/graph-client';
import type { DeviceActionRequest, DeviceActionResponse } from '@/types/devices';

// sendCustomNotificationToCompanyPortal returned "Resource not found for the
// segment" on v1.0 against a live tenant - same stale-docs/version-gap
// pattern as deviceStatuses and logCollectionRequests elsewhere in this
// codebase. Beta confirmed working empirically; used for all actions here
// for consistency rather than splitting bases per-action.
const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

const PERMISSION_ERROR_BODY = {
  error:
    'Missing required permission: DeviceManagementManagedDevices.ReadWrite.All. Please add this permission to your Azure AD app registration and grant admin consent.',
  permissionRequired: 'DeviceManagementManagedDevices.ReadWrite.All',
};

/** Turns a raw Graph error body into a short, user-facing message. */
function toUserFacingMessage(action: string, bodyText: string, statusText: string): string {
  if (bodyText.includes('StatelessDeviceFEService') || bodyText.includes('An error has occurred')) {
    return `Microsoft Intune couldn't ${action} for this device right now (a generic error from Intune's device-action service). This can happen due to a temporary service issue - try again in a few minutes.`;
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

const ACTION_ENDPOINTS: Record<'sync' | 'reboot' | 'shutdown', string> = {
  sync: 'syncDevice',
  reboot: 'rebootNow',
  shutdown: 'shutDown',
};

const ACTION_LABELS: Record<'sync' | 'reboot' | 'shutdown' | 'notify', string> = {
  sync: 'sync device',
  reboot: 'restart device',
  shutdown: 'shut down device',
  notify: 'send notification',
};

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

    const body: DeviceActionRequest = await request.json();

    const tenantResult = await resolveTenant(request, user);
    if (tenantResult.errorResponse) return tenantResult.errorResponse;
    const tenantId = tenantResult.tenantId!;

    const token = await getServicePrincipalToken(tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    let endpoint: string;
    let graphBody: Record<string, unknown> | undefined;

    if (body.action === 'notify') {
      if (!body.notificationTitle?.trim() || !body.notificationBody?.trim()) {
        return NextResponse.json(
          { error: 'notificationTitle and notificationBody are required' },
          { status: 400 }
        );
      }
      endpoint = 'sendCustomNotificationToCompanyPortal';
      graphBody = {
        notificationTitle: body.notificationTitle.trim(),
        notificationBody: body.notificationBody.trim(),
      };
    } else if (body.action === 'sync' || body.action === 'reboot' || body.action === 'shutdown') {
      endpoint = ACTION_ENDPOINTS[body.action];
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const response = await fetch(
      `${GRAPH_API_BASE}/deviceManagement/managedDevices/${encodeURIComponent(id)}/${endpoint}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: graphBody ? JSON.stringify(graphBody) : undefined,
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        invalidateServicePrincipalToken(tenantId);
      }
      const bodyText = await response.text().catch(() => '');
      console.error(`Error performing device action (${body.action}):`, response.status, bodyText);
      if (response.status === 403 && bodyText.includes('DeviceManagementManagedDevices')) {
        return NextResponse.json(PERMISSION_ERROR_BODY, { status: 403 });
      }
      if (response.status === 404) {
        return NextResponse.json({ error: 'Device not found' }, { status: 404 });
      }
      return NextResponse.json(
        { error: toUserFacingMessage(ACTION_LABELS[body.action], bodyText, response.statusText) },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true } satisfies DeviceActionResponse);
  } catch (error) {
    console.error('Error in device actions route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to perform device action' },
      { status: 500 }
    );
  }
}
