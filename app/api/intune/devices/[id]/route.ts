/**
 * Managed Device Detail API Route
 * Gets full details for a single Intune-managed device.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { parseAccessToken } from '@/lib/auth-utils';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import type { ManagedDeviceDetail, ManagedDeviceDetailResponse } from '@/types/devices';

// hardwareInformation and several other selected fields below don't exist on
// v1.0's managedDevice schema ("Could not find a property..." 400) - only on
// beta. Same stale-docs/version-gap pattern hit elsewhere in this codebase
// (deviceStatuses, deviceLogCollectionResponse); confirmed via direct testing.
const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

const DEVICE_DETAIL_SELECT = [
  'id',
  'deviceName',
  'operatingSystem',
  'osVersion',
  'complianceState',
  'lastSyncDateTime',
  'model',
  'manufacturer',
  'managedDeviceOwnerType',
  'userPrincipalName',
  'serialNumber',
  'imei',
  'totalStorageSpaceInBytes',
  'freeStorageSpaceInBytes',
  'physicalMemoryInBytes',
  'enrolledDateTime',
  'deviceEnrollmentType',
  'managementAgent',
  'managementState',
  'azureADDeviceId',
  'deviceHealthAttestationState',
  'hardwareInformation',
  'chassisType',
  'processorArchitecture',
  'joinType',
  'isEncrypted',
  'ethernetMacAddress',
  'wiFiMacAddress',
  'skuFamily',
  'skuNumber',
  'deviceFirmwareConfigurationInterfaceManaged',
  'configurationManagerClientHealthState',
  'configurationManagerClientInformation',
].join(',');

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

    const response = await fetch(
      `${GRAPH_API_BASE}/deviceManagement/managedDevices/${encodeURIComponent(id)}?$select=${DEVICE_DETAIL_SELECT}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({ error: 'Device not found' }, { status: 404 });
      }
      const bodyText = await response.text().catch(() => '');
      if (response.status === 403 && bodyText.includes('DeviceManagementManagedDevices')) {
        return NextResponse.json(
          {
            error:
              'Missing required permission: DeviceManagementManagedDevices.Read.All. Please add this permission to your Azure AD app registration and grant admin consent.',
            permissionRequired: 'DeviceManagementManagedDevices.Read.All',
          },
          { status: 403 }
        );
      }
      console.error('Error fetching device details:', response.status, bodyText);
      return NextResponse.json(
        { error: `Failed to fetch device details: ${bodyText || response.statusText}` },
        { status: response.status }
      );
    }

    const device: ManagedDeviceDetail = await response.json();

    return NextResponse.json({ device } as ManagedDeviceDetailResponse);
  } catch (error) {
    console.error('Error fetching device details:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch device details' },
      { status: 500 }
    );
  }
}
