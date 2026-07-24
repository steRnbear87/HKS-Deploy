/**
 * Driver inventory for a Driver Update Profile.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import { listDriverInventory } from '@/lib/intune/windows-driver-updates';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const drivers = await listDriverInventory(token, id);
    return NextResponse.json({ drivers, count: drivers.length });
  } catch (error) {
    console.error('[GET /api/intune/windows-updates/driver-profiles/[id]/drivers] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to list driver inventory' }, { status: 500 });
  }
}
