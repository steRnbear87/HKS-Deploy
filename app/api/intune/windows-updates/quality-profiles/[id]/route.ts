/**
 * Single Quality Update Profile - read, delete.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import { getQualityUpdateProfile, deleteQualityUpdateProfile } from '@/lib/intune/windows-quality-updates';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const profile = await getQualityUpdateProfile(token, id);
    return NextResponse.json({ profile });
  } catch (error) {
    console.error('[GET /api/intune/windows-updates/quality-profiles/[id]] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to get quality update profile' }, { status: 500 });
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

    await deleteQualityUpdateProfile(token, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/intune/windows-updates/quality-profiles/[id]] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to delete quality update profile' }, { status: 500 });
  }
}
