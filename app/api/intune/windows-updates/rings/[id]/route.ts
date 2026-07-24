/**
 * Single Windows Update Ring - read, update, delete.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import { getUpdateRing, updateUpdateRing, deleteUpdateRing } from '@/lib/intune/windows-update-rings';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const ring = await getUpdateRing(token, id);
    return NextResponse.json({ ring });
  } catch (error) {
    console.error('[GET /api/intune/windows-updates/rings/[id]] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to get update ring' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const body = await request.json();
    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    await updateUpdateRing(token, id, body);
    const ring = await getUpdateRing(token, id);
    return NextResponse.json({ ring });
  } catch (error) {
    console.error('[PATCH /api/intune/windows-updates/rings/[id]] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to update update ring' }, { status: 500 });
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

    await deleteUpdateRing(token, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/intune/windows-updates/rings/[id]] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to delete update ring' }, { status: 500 });
  }
}
