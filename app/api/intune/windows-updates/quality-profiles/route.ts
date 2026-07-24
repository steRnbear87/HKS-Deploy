/**
 * Quality Update Profiles collection - list and create.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import {
  listQualityUpdateProfiles,
  createQualityUpdateProfile,
  listQualityUpdateProfileAssignments,
} from '@/lib/intune/windows-quality-updates';
import { attachAssignmentSummaries } from '@/lib/intune/windows-update-assignments';

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const profiles = await listQualityUpdateProfiles(token);
    const withAssignments = await attachAssignmentSummaries(token, profiles, listQualityUpdateProfileAssignments);
    return NextResponse.json({ profiles: withAssignments, count: profiles.length });
  } catch (error) {
    console.error('[GET /api/intune/windows-updates/quality-profiles] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to list quality update profiles' }, { status: 500 });
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

    const profile = await createQualityUpdateProfile(token, {
      displayName: body.displayName,
      description: body.description,
      releaseDateDisplayName: body.releaseDateDisplayName,
      expedited: body.expedited,
    });

    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/intune/windows-updates/quality-profiles] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to create quality update profile' }, { status: 500 });
  }
}
