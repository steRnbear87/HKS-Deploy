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

    // Whitelist to the same fields the sibling POST route accepts, rather
    // than spreading the raw request body into the Graph payload - matching
    // updateUpdateRing's Partial<CreateUpdateRingInput> parameter type field
    // for field, since it forwards whatever it's given unvalidated.
    const update: Record<string, unknown> = {};
    if (body.displayName !== undefined) update.displayName = body.displayName;
    if (body.description !== undefined) update.description = body.description;
    if (body.qualityUpdatesDeferralPeriodInDays !== undefined) {
      update.qualityUpdatesDeferralPeriodInDays = body.qualityUpdatesDeferralPeriodInDays;
    }
    if (body.featureUpdatesDeferralPeriodInDays !== undefined) {
      update.featureUpdatesDeferralPeriodInDays = body.featureUpdatesDeferralPeriodInDays;
    }
    if (body.qualityUpdatesPaused !== undefined) update.qualityUpdatesPaused = body.qualityUpdatesPaused;
    if (body.featureUpdatesPaused !== undefined) update.featureUpdatesPaused = body.featureUpdatesPaused;
    if (body.deadlineForQualityUpdatesInDays !== undefined) {
      update.deadlineForQualityUpdatesInDays = body.deadlineForQualityUpdatesInDays;
    }
    if (body.deadlineForFeatureUpdatesInDays !== undefined) {
      update.deadlineForFeatureUpdatesInDays = body.deadlineForFeatureUpdatesInDays;
    }
    if (body.deadlineGracePeriodInDays !== undefined) {
      update.deadlineGracePeriodInDays = body.deadlineGracePeriodInDays;
    }

    await updateUpdateRing(token, id, update);
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
