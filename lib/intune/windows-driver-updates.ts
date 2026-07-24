/**
 * Windows Driver Update Profiles (windowsDriverUpdateProfile)
 *
 * Beta-only resource under deviceManagement/windowsDriverUpdateProfiles.
 * Assignment is group-only, same as every other Windows Update resource -
 * see lib/intune/device-update-groups.ts for the per-device workaround.
 *
 * Driver approval (driverInventories) is scoped to a driver WITHIN a
 * profile's target group, not to an individual device within that group -
 * but since this feature's model gives every device its own dedicated
 * single-device group, approving/declining a driver on that device's profile
 * only ever affects that one device in practice.
 */

import { fetchWithRetry } from './graph-client';
import type { DriverUpdateProfile, DriverInventoryItem } from '@/types/windows-updates';
import type { AssignmentTarget } from '@/types/intune';

const GRAPH_API_BASE_BETA = 'https://graph.microsoft.com/beta';
const RESOURCE = 'deviceManagement/windowsDriverUpdateProfiles';

function toDriverUpdateProfile(raw: Record<string, unknown>): DriverUpdateProfile {
  return {
    id: raw.id as string,
    displayName: raw.displayName as string,
    description: (raw.description as string) || undefined,
    approvalType: raw.approvalType as 'manual' | 'automatic' | undefined,
    deploymentDeferralInDays: raw.deploymentDeferralInDays as number | undefined,
    createdDateTime: raw.createdDateTime as string | undefined,
    lastModifiedDateTime: raw.lastModifiedDateTime as string | undefined,
  };
}

function toDriverInventoryItem(raw: Record<string, unknown>): DriverInventoryItem {
  return {
    id: raw.id as string,
    name: raw.name as string,
    version: raw.version as string,
    manufacturer: raw.manufacturer as string | undefined,
    category: raw.category as string | undefined,
    approvalStatus: (raw.approvalStatus as DriverInventoryItem['approvalStatus']) || 'needsReview',
    applicableDeviceCount: raw.applicableDeviceCount as number | undefined,
    deployDateTime: (raw.deployDateTime as string | null) ?? null,
  };
}

export async function listDriverUpdateProfiles(token: string): Promise<DriverUpdateProfile[]> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, 3);

  if (!response.ok) {
    throw new Error(`Failed to list driver update profiles: ${response.status}`);
  }

  const data: { value?: Array<Record<string, unknown>> } = await response.json();
  return (data.value || []).map(toDriverUpdateProfile);
}

export async function getDriverUpdateProfile(token: string, profileId: string): Promise<DriverUpdateProfile> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}/${profileId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, 3);

  if (!response.ok) {
    throw new Error(`Failed to get driver update profile ${profileId}: ${response.status}`);
  }

  return toDriverUpdateProfile(await response.json());
}

export interface CreateDriverUpdateProfileInput {
  displayName: string;
  description?: string;
  approvalType?: 'manual' | 'automatic';
  deploymentDeferralInDays?: number;
}

export async function createDriverUpdateProfile(
  token: string,
  input: CreateDriverUpdateProfileInput
): Promise<DriverUpdateProfile> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: input.displayName,
      description: input.description,
      approvalType: input.approvalType ?? 'manual',
      deploymentDeferralInDays: input.deploymentDeferralInDays ?? 0,
    }),
  }, 3);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to create driver update profile: ${response.status} ${body}`);
  }

  return toDriverUpdateProfile(await response.json());
}

export async function deleteDriverUpdateProfile(token: string, profileId: string): Promise<void> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}/${profileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }, 3);

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete driver update profile ${profileId}: ${response.status}`);
  }
}

export async function assignDriverUpdateProfile(
  token: string,
  profileId: string,
  targets: AssignmentTarget[]
): Promise<void> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}/${profileId}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments: targets.map((target) => ({ target })) }),
  }, 3);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to assign driver update profile ${profileId}: ${response.status} ${body}`);
  }
}

export async function listDriverUpdateProfileAssignments(
  token: string,
  profileId: string
): Promise<AssignmentTarget[]> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}/${profileId}/assignments`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, 3);

  if (!response.ok) {
    throw new Error(`Failed to list assignments for driver update profile ${profileId}: ${response.status}`);
  }

  const data: { value?: Array<{ target: AssignmentTarget }> } = await response.json();
  return (data.value || []).map((a) => a.target);
}

export async function listDriverInventory(token: string, profileId: string): Promise<DriverInventoryItem[]> {
  const response = await fetchWithRetry(
    `${GRAPH_API_BASE_BETA}/${RESOURCE}/${profileId}/driverInventories`,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    3
  );

  if (!response.ok) {
    throw new Error(`Failed to list driver inventory for profile ${profileId}: ${response.status}`);
  }

  const data: { value?: Array<Record<string, unknown>> } = await response.json();
  return (data.value || []).map(toDriverInventoryItem);
}

export async function setDriverApprovalStatus(
  token: string,
  profileId: string,
  driverId: string,
  approvalStatus: DriverInventoryItem['approvalStatus']
): Promise<void> {
  const response = await fetchWithRetry(
    `${GRAPH_API_BASE_BETA}/${RESOURCE}/${profileId}/driverInventories/${driverId}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalStatus }),
    },
    3
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to set driver approval status: ${response.status} ${body}`);
  }
}
