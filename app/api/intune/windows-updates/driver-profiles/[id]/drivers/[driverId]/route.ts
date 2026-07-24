/**
 * Approve/decline a specific driver within a Driver Update Profile's inventory.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import { setDriverApprovalStatus } from '@/lib/intune/windows-driver-updates';

const VALID_STATUSES = ['needsReview', 'declined', 'approved', 'suspended'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; driverId: string }> }
) {
  try {
    const { id, driverId } = await params;
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const body = await request.json();
    if (!VALID_STATUSES.includes(body.approvalStatus)) {
      return NextResponse.json(
        { error: `approvalStatus must be one of ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    await setDriverApprovalStatus(token, id, driverId, body.approvalStatus);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/intune/windows-updates/driver-profiles/[id]/drivers/[driverId]] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to update driver approval status' }, { status: 500 });
  }
}
