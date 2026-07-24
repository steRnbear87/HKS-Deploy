/**
 * Feature Update Profiles collection - list and create.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import {
  listFeatureUpdateProfiles,
  createFeatureUpdateProfile,
  listFeatureUpdateProfileAssignments,
} from '@/lib/intune/windows-feature-updates';
import { attachAssignmentSummaries } from '@/lib/intune/windows-update-assignments';

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const profiles = await listFeatureUpdateProfiles(token);
    const withAssignments = await attachAssignmentSummaries(token, profiles, listFeatureUpdateProfileAssignments);
    return NextResponse.json({ profiles: withAssignments, count: profiles.length });
  } catch (error) {
    console.error('[GET /api/intune/windows-updates/feature-profiles] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to list feature update profiles' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const body = await request.json();
    if (!body.displayName || !body.featureUpdateVersion) {
      return NextResponse.json({ error: 'displayName and featureUpdateVersion are required' }, { status: 400 });
    }

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const profile = await createFeatureUpdateProfile(token, {
      displayName: body.displayName,
      description: body.description,
      featureUpdateVersion: body.featureUpdateVersion,
      installLatestWindows10OnWindows11IneligibleDevice: body.installLatestWindows10OnWindows11IneligibleDevice,
      installFeatureUpdatesOptional: body.installFeatureUpdatesOptional,
    });

    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/intune/windows-updates/feature-profiles] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to create feature update profile' }, { status: 500 });
  }
}
