/**
 * Single Driver Update Profile - read, delete.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import { getDriverUpdateProfile, deleteDriverUpdateProfile } from '@/lib/intune/windows-driver-updates';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const profile = await getDriverUpdateProfile(token, id);
    return NextResponse.json({ profile });
  } catch (error) {
    console.error('[GET /api/intune/windows-updates/driver-profiles/[id]] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to get driver update profile' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    await deleteDriverUpdateProfile(token, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/intune/windows-updates/driver-profiles/[id]] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to delete driver update profile' }, { status: 500 });
  }
}
