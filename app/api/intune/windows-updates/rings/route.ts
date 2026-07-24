/**
 * Windows Update Rings collection - list and create.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import { listUpdateRings, createUpdateRing, listUpdateRingAssignments } from '@/lib/intune/windows-update-rings';
import { attachAssignmentSummaries } from '@/lib/intune/windows-update-assignments';

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const rings = await listUpdateRings(token);
    const withAssignments = await attachAssignmentSummaries(token, rings, listUpdateRingAssignments);
    return NextResponse.json({ rings: withAssignments, count: rings.length });
  } catch (error) {
    console.error('[GET /api/intune/windows-updates/rings] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to list update rings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const body = await request.json();
    if (!body.displayName || typeof body.displayName !== 'string') {
      return NextResponse.json({ error: 'displayName is required' }, { status: 400 });
    }

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const ring = await createUpdateRing(token, {
      displayName: body.displayName,
      description: body.description,
      qualityUpdatesDeferralPeriodInDays: body.qualityUpdatesDeferralPeriodInDays ?? 0,
      featureUpdatesDeferralPeriodInDays: body.featureUpdatesDeferralPeriodInDays ?? 0,
      qualityUpdatesPaused: body.qualityUpdatesPaused,
      featureUpdatesPaused: body.featureUpdatesPaused,
      deadlineForQualityUpdatesInDays: body.deadlineForQualityUpdatesInDays,
      deadlineForFeatureUpdatesInDays: body.deadlineForFeatureUpdatesInDays,
      deadlineGracePeriodInDays: body.deadlineGracePeriodInDays,
    });

    return NextResponse.json({ ring }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/intune/windows-updates/rings] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to create update ring' }, { status: 500 });
  }
}
