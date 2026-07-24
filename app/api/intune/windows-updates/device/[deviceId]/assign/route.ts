/**
 * Device-centric Windows Update assign - the actual "pick which updates to
 * deploy per device" action. Ensures this device's tool-managed single-device
 * group exists, then assigns (or unassigns) the requested policy to it.
 *
 * A device's group is only ever assigned to at most one profile per policy
 * type at a time, so assigning a new profile first removes the group from
 * whichever profile of that same type it was previously assigned to (Graph's
 * assign action replaces a profile's ENTIRE assignment list, so this is a
 * read-modify-write per affected profile, not a single call).
 *
 * Exception: an expedited quality update on a tenant with Windows Autopatch
 * enabled skips the group workaround entirely and targets the device
 * directly via Autopatch's native per-device deploymentAudience.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import { ensureDeviceUpdateGroup } from '@/lib/intune/device-update-groups';
import { listUpdateRings, listUpdateRingAssignments, assignUpdateRing } from '@/lib/intune/windows-update-rings';
import {
  listFeatureUpdateProfiles,
  listFeatureUpdateProfileAssignments,
  assignFeatureUpdateProfile,
} from '@/lib/intune/windows-feature-updates';
import {
  listQualityUpdateProfiles,
  listQualityUpdateProfileAssignments,
  assignQualityUpdateProfile,
  getQualityUpdateProfile,
} from '@/lib/intune/windows-quality-updates';
import {
  listDriverUpdateProfiles,
  listDriverUpdateProfileAssignments,
  assignDriverUpdateProfile,
} from '@/lib/intune/windows-driver-updates';
import { isAutopatchEnabled, createExpeditedDeploymentForDevices } from '@/lib/intune/windows-autopatch';
import type { AssignmentTarget } from '@/types/intune';

interface AssignRequestBody {
  policyType: 'ring' | 'feature' | 'quality' | 'driver';
  policyId: string | null; // null = unassign
  azureADDeviceId: string;
  deviceName: string;
}

interface PolicyTypeOps {
  list: (token: string) => Promise<{ id: string }[]>;
  listAssignments: (token: string, profileId: string) => Promise<AssignmentTarget[]>;
  assign: (token: string, profileId: string, targets: AssignmentTarget[]) => Promise<void>;
}

const POLICY_OPS: Record<AssignRequestBody['policyType'], PolicyTypeOps> = {
  ring: { list: listUpdateRings, listAssignments: listUpdateRingAssignments, assign: assignUpdateRing },
  feature: {
    list: listFeatureUpdateProfiles,
    listAssignments: listFeatureUpdateProfileAssignments,
    assign: assignFeatureUpdateProfile,
  },
  quality: {
    list: listQualityUpdateProfiles,
    listAssignments: listQualityUpdateProfileAssignments,
    assign: assignQualityUpdateProfile,
  },
  driver: {
    list: listDriverUpdateProfiles,
    listAssignments: listDriverUpdateProfileAssignments,
    assign: assignDriverUpdateProfile,
  },
};

async function removeGroupFromProfile(
  token: string,
  ops: PolicyTypeOps,
  profileId: string,
  groupId: string
): Promise<void> {
  const current = await ops.listAssignments(token, profileId);
  const remaining = current.filter(
    (a) => !(a['@odata.type'] === '#microsoft.graph.groupAssignmentTarget' && a.groupId === groupId)
  );
  if (remaining.length !== current.length) {
    await ops.assign(token, profileId, remaining);
  }
}

async function addGroupToProfile(
  token: string,
  ops: PolicyTypeOps,
  profileId: string,
  groupId: string
): Promise<void> {
  const current = await ops.listAssignments(token, profileId);
  const alreadyPresent = current.some(
    (a) => a['@odata.type'] === '#microsoft.graph.groupAssignmentTarget' && a.groupId === groupId
  );
  if (alreadyPresent) return;

  const target: AssignmentTarget = { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId };
  await ops.assign(token, profileId, [...current, target]);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  try {
    const { deviceId } = await params;
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const body: AssignRequestBody = await request.json();
    const ops = POLICY_OPS[body.policyType];
    if (!ops) {
      return NextResponse.json({ error: `Unsupported policyType "${body.policyType}"` }, { status: 400 });
    }
    if (!body.azureADDeviceId || !body.deviceName) {
      return NextResponse.json({ error: 'azureADDeviceId and deviceName are required' }, { status: 400 });
    }

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    // Expedited quality update on an Autopatch-enabled tenant: skip the group
    // workaround entirely and target this device directly.
    if (body.policyType === 'quality' && body.policyId) {
      const profile = await getQualityUpdateProfile(token, body.policyId);
      if (profile.expedited?.qualityUpdateRelease) {
        const autopatch = await isAutopatchEnabled(auth.tenantId, token);
        if (autopatch) {
          await createExpeditedDeploymentForDevices(token, {
            qualityUpdateCatalogEntryId: profile.expedited.qualityUpdateRelease,
            daysUntilForcedReboot: profile.expedited.daysUntilForcedReboot,
            azureADDeviceIds: [body.azureADDeviceId],
          });
          return NextResponse.json({ success: true, method: 'autopatch' });
        }
      }
    }

    const { groupId } = await ensureDeviceUpdateGroup(
      auth.tenantId,
      deviceId,
      body.azureADDeviceId,
      body.deviceName
    );

    const profiles = await ops.list(token);
    for (const profile of profiles) {
      if (profile.id === body.policyId) continue;
      await removeGroupFromProfile(token, ops, profile.id, groupId);
    }

    if (body.policyId) {
      await addGroupToProfile(token, ops, body.policyId, groupId);
    }

    return NextResponse.json({ success: true, method: 'group' });
  } catch (error) {
    console.error('[POST /api/intune/windows-updates/device/[deviceId]/assign] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to update device Windows Update assignment' }, { status: 500 });
  }
}
