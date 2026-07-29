/**
 * Device Compliance Policy & Configuration Profile Status API Route
 *
 * Backed by Graph's `deviceCompliancePolicyStates`/`deviceConfigurationStates`
 * nav properties on `managedDevices/{id}`. Confirmed via direct curl testing
 * against the live tenant: both work on v1.0 with real per-policy/per-profile
 * state values. The Graph response has been observed to contain duplicate
 * rows (same `id` twice) for some devices - deduped below.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import { getServicePrincipalToken, invalidateServicePrincipalToken, fetchWithRetry } from '@/lib/intune/graph-client';
import type {
  DeviceCompliancePolicyState,
  DeviceConfigurationState,
  DeviceComplianceStatusResponse,
} from '@/types/devices';

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
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

interface NavFetchResult<T> {
  ok: boolean;
  status: number;
  bodyText: string;
  rows: T[];
}

async function fetchNavCollection<T>(url: string, token: string, tenantId: string): Promise<NavFetchResult<T>> {
  const response = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, 3);

  if (!response.ok) {
    if (response.status === 401) {
      invalidateServicePrincipalToken(tenantId);
    }
    const bodyText = await response.text().catch(() => '');
    return { ok: false, status: response.status, bodyText, rows: [] };
  }

  const data: { value?: T[] } = await response.json();
  return { ok: true, status: response.status, bodyText: '', rows: data.value ?? [] };
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

    const encodedId = encodeURIComponent(id);
    const [complianceResult, configResult] = await Promise.all([
      fetchNavCollection<DeviceCompliancePolicyState>(
        `${GRAPH_API_BASE}/deviceManagement/managedDevices/${encodedId}/deviceCompliancePolicyStates` +
          `?$select=id,displayName,state,platformType,version`,
        token,
        tenantId
      ),
      fetchNavCollection<DeviceConfigurationState>(
        `${GRAPH_API_BASE}/deviceManagement/managedDevices/${encodedId}/deviceConfigurationStates` +
          `?$select=id,displayName,state,platformType,version,settingCount`,
        token,
        tenantId
      ),
    ]);

    if (!complianceResult.ok && !configResult.ok) {
      console.error(
        'Both compliance-status queries failed:',
        complianceResult.status,
        complianceResult.bodyText,
        configResult.status,
        configResult.bodyText
      );

      if (
        (complianceResult.status === 403 && complianceResult.bodyText.includes('DeviceManagement')) ||
        (configResult.status === 403 && configResult.bodyText.includes('DeviceManagement'))
      ) {
        return NextResponse.json({
          configured: false,
          reason: 'Missing required permission to read device compliance/configuration state.',
          permissionRequired: 'DeviceManagementConfiguration.Read.All',
        } as DeviceComplianceStatusResponse);
      }

      if (complianceResult.status === 404 || configResult.status === 404) {
        return NextResponse.json({ error: 'Device not found' }, { status: 404 });
      }

      return NextResponse.json(
        { error: 'Failed to fetch compliance/configuration status.' },
        { status: complianceResult.status || configResult.status || 500 }
      );
    }

    return NextResponse.json({
      configured: true,
      compliancePolicyStates: complianceResult.ok ? dedupeById(complianceResult.rows) : [],
      configurationStates: configResult.ok ? dedupeById(configResult.rows) : [],
    } as DeviceComplianceStatusResponse);
  } catch (error) {
    console.error('Error in device compliance-status route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch compliance status' },
      { status: 500 }
    );
  }
}
