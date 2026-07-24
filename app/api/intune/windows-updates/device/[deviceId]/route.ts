/**
 * Device-centric Windows Update read - resolves this device's tool-managed
 * update group (if any) and its current effective assignment across the
 * Windows Update policy types. Ring, feature, quality, and driver are
 * populated (slices 2-4); m365Apps comes in a later slice and reads as null.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import { getDatabase } from '@/lib/db';
import { listUpdateRings, listUpdateRingAssignments } from '@/lib/intune/windows-update-rings';
import { listFeatureUpdateProfiles, listFeatureUpdateProfileAssignments } from '@/lib/intune/windows-feature-updates';
import { listQualityUpdateProfiles, listQualityUpdateProfileAssignments } from '@/lib/intune/windows-quality-updates';
import { listDriverUpdateProfiles, listDriverUpdateProfileAssignments } from '@/lib/intune/windows-driver-updates';
import type { DeviceWindowsUpdateAssignments } from '@/types/windows-updates';
import type { AssignmentTarget } from '@/types/intune';

/** Finds the first profile (of any listable type) whose assignments target
 * this group - shared shape across ring/feature/quality scans. */
async function findAssignedProfile<T extends { id: string }>(
  groupId: string,
  profiles: T[],
  listAssignments: (profileId: string) => Promise<AssignmentTarget[]>
): Promise<T | null> {
  for (const profile of profiles) {
    const assignments = await listAssignments(profile.id);
    const matches = assignments.some(
      (a) => a['@odata.type'] === '#microsoft.graph.groupAssignmentTarget' && a.groupId === groupId
    );
    if (matches) return profile;
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  try {
    const { deviceId } = await params;
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const db = getDatabase();
    const groupRecord = await db.deviceUpdateGroups.getByDeviceId(auth.tenantId, deviceId);

    const result: DeviceWindowsUpdateAssignments = {
      deviceId,
      updateGroup: groupRecord
        ? {
            deviceId: groupRecord.device_id,
            azureADDeviceId: groupRecord.azure_ad_device_id,
            entraGroupId: groupRecord.entra_group_id,
            createdAt: groupRecord.created_at,
          }
        : null,
      ring: null,
      feature: null,
      quality: null,
      driver: null,
      m365Apps: null,
    };

    // No group yet means nothing has ever been assigned to this device.
    if (!groupRecord) {
      return NextResponse.json(result);
    }

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    // Find which profile of each type (if any) targets this group. Profile
    // counts are small (tens, not thousands) so an assignments-per-profile
    // scan is fine - there is no bulk "assignments for group X across all
    // profiles" Graph query. Runs the three scans concurrently since they're
    // independent Graph resources.
    const [rings, features, qualities, drivers] = await Promise.all([
      listUpdateRings(token),
      listFeatureUpdateProfiles(token),
      listQualityUpdateProfiles(token),
      listDriverUpdateProfiles(token),
    ]);

    const [ring, feature, quality, driver] = await Promise.all([
      findAssignedProfile(groupRecord.entra_group_id, rings, (id) => listUpdateRingAssignments(token, id)),
      findAssignedProfile(groupRecord.entra_group_id, features, (id) => listFeatureUpdateProfileAssignments(token, id)),
      findAssignedProfile(groupRecord.entra_group_id, qualities, (id) => listQualityUpdateProfileAssignments(token, id)),
      findAssignedProfile(groupRecord.entra_group_id, drivers, (id) => listDriverUpdateProfileAssignments(token, id)),
    ]);

    result.ring = ring;
    result.feature = feature;
    result.quality = quality;
    result.driver = driver;

    return NextResponse.json(result);
  } catch (error) {
    console.error('[GET /api/intune/windows-updates/device/[deviceId]] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to load device Windows Update assignments' }, { status: 500 });
  }
}
