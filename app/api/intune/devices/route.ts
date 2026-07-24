/**
 * Managed Devices List API Route
 * Lists Intune-managed devices for the tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import {
  GRAPH_API_BASE,
  fetchWithRetry,
  getServicePrincipalToken,
  invalidateServicePrincipalToken,
} from '@/lib/intune/graph-client';
import { getDatabase } from '@/lib/db';
import type { ManagedDevice, ManagedDevicesResponse } from '@/types/devices';

export const maxDuration = 60;

// Overall budget for the Graph pagination scan. Must leave headroom under
// maxDuration so a throttled tenant gets a partial list instead of a hang.
const SCAN_BUDGET_MS = 40_000;

const DEVICE_SELECT =
  'id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,model,manufacturer,managedDeviceOwnerType,userPrincipalName,isEncrypted,managementAgent,enrolledDateTime,serialNumber,azureADDeviceId';

interface GraphFetchError extends Error {
  status: number;
  bodyText: string;
}

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

    const token = await getServicePrincipalToken(tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const scanDeadline = Date.now() + SCAN_BUDGET_MS;
    const devices: ManagedDevice[] = [];
    let partial = false;

    let nextUrl: string | null =
      `${GRAPH_API_BASE}/deviceManagement/managedDevices?$select=${DEVICE_SELECT}`;

    try {
      while (nextUrl) {
        if (Date.now() >= scanDeadline) {
          partial = true;
          break;
        }

        const response: Response = await fetchWithRetry(
          nextUrl,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
          3,
          scanDeadline
        );

        if (!response.ok) {
          if (response.status === 401) {
            invalidateServicePrincipalToken(tenantId);
          }
          const bodyText = await response.text().catch(() => '');
          const error = new Error(`Graph managedDevices ${response.status}`) as GraphFetchError;
          error.status = response.status;
          error.bodyText = bodyText;
          throw error;
        }

        const data: { value?: ManagedDevice[]; '@odata.nextLink'?: string } = await response.json();
        if (Array.isArray(data.value)) {
          devices.push(...data.value);
        }
        nextUrl = data['@odata.nextLink'] || null;
      }
    } catch (err) {
      const graphError = err as GraphFetchError;
      const budgetExhausted =
        (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) ||
        Date.now() >= scanDeadline;

      if (budgetExhausted) {
        partial = true;
      } else {
        if (
          graphError.status === 403 &&
          graphError.bodyText?.includes('DeviceManagementManagedDevices')
        ) {
          return NextResponse.json(
            {
              error:
                'Missing required permission: DeviceManagementManagedDevices.Read.All. Please add this permission to your Azure AD app registration and grant admin consent.',
              permissionRequired: 'DeviceManagementManagedDevices.Read.All',
            },
            { status: 403 }
          );
        }
        if (graphError.status === 429) {
          return NextResponse.json(
            {
              error:
                'Microsoft Graph is throttling requests for this tenant. Please wait a minute and try again.',
            },
            { status: 429 }
          );
        }

        console.error('Error fetching managed devices:', err);
        return NextResponse.json(
          { error: 'Failed to fetch devices from Intune' },
          { status: graphError.status && graphError.status >= 400 ? graphError.status : 502 }
        );
      }
    }

    // Join in cached BIOS versions (device_bios_info) - one bulk query, not
    // a per-device lookup, since this route already does a full live Graph
    // sweep on every page load. Best-effort: a DB hiccup here shouldn't fail
    // the whole device list, just leave BIOS unset for this response.
    try {
      const biosRows = await getDatabase().deviceBiosInfo.getByTenantId(tenantId);
      const biosByDeviceId = new Map(biosRows.map((row) => [row.device_id, row]));
      for (const device of devices) {
        const biosRow = biosByDeviceId.get(device.id);
        device.biosVersion = biosRow?.bios_version ?? null;
        device.biosCapturedAt = biosRow?.captured_at ?? null;
      }
    } catch (error) {
      console.error(`Failed to join BIOS cache for tenant ${tenantId}:`, error);
    }

    return NextResponse.json({
      devices,
      total: devices.length,
      partial,
    } as ManagedDevicesResponse);
  } catch (error) {
    console.error('Error in devices route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch devices' },
      { status: 500 }
    );
  }
}
