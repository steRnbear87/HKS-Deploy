/**
 * Driver Update Profiles collection - list and create.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import {
  listDriverUpdateProfiles,
  createDriverUpdateProfile,
  listDriverUpdateProfileAssignments,
} from '@/lib/intune/windows-driver-updates';
import { attachAssignmentSummaries } from '@/lib/intune/windows-update-assignments';

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const profiles = await listDriverUpdateProfiles(token);
    const withAssignments = await attachAssignmentSummaries(token, profiles, listDriverUpdateProfileAssignments);
    return NextResponse.json({ profiles: withAssignments, count: profiles.length });
  } catch (error) {
    console.error('[GET /api/intune/windows-updates/driver-profiles] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to list driver update profiles' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const body = await request.json();
    if (!body.displayName) {
      return NextResponse.json({ error: 'displayName is required' }, { status: 400 });
    }

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const profile = await createDriverUpdateProfile(token, {
      displayName: body.displayName,
      description: body.description,
      approvalType: body.approvalType,
      deploymentDeferralInDays: body.deploymentDeferralInDays,
    });

    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/intune/windows-updates/driver-profiles] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to create driver update profile' }, { status: 500 });
  }
}
