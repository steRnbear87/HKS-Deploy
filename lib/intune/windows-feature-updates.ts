/**
 * Windows Feature Update Profiles (windowsFeatureUpdateProfile)
 *
 * Beta-only resource under deviceManagement/windowsFeatureUpdateProfiles -
 * pins a target Windows feature update version (e.g. "24H2"). Assignment is
 * group-only - see lib/intune/device-update-groups.ts for the per-device
 * workaround.
 */

import { fetchWithRetry } from './graph-client';
import type { FeatureUpdateProfile } from '@/types/windows-updates';
import type { AssignmentTarget } from '@/types/intune';

// windowsFeatureUpdateProfile has no v1.0 equivalent - confirmed against
// current Microsoft Learn docs, beta only.
const GRAPH_API_BASE_BETA = 'https://graph.microsoft.com/beta';
const RESOURCE = 'deviceManagement/windowsFeatureUpdateProfiles';

function toFeatureUpdateProfile(raw: Record<string, unknown>): FeatureUpdateProfile {
  return {
    id: raw.id as string,
    displayName: raw.displayName as string,
    description: (raw.description as string) || undefined,
    featureUpdateVersion: raw.featureUpdateVersion as string,
    installLatestWindows10OnWindows11IneligibleDevice:
      raw.installLatestWindows10OnWindows11IneligibleDevice as boolean | undefined,
    installFeatureUpdatesOptional: raw.installFeatureUpdatesOptional as boolean | undefined,
    createdDateTime: raw.createdDateTime as string | undefined,
    lastModifiedDateTime: raw.lastModifiedDateTime as string | undefined,
  };
}

export async function listFeatureUpdateProfiles(token: string): Promise<FeatureUpdateProfile[]> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, 3);

  if (!response.ok) {
    throw new Error(`Failed to list feature update profiles: ${response.status}`);
  }

  const data: { value?: Array<Record<string, unknown>> } = await response.json();
  return (data.value || []).map(toFeatureUpdateProfile);
}

export async function getFeatureUpdateProfile(token: string, profileId: string): Promise<FeatureUpdateProfile> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}/${profileId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, 3);

  if (!response.ok) {
    throw new Error(`Failed to get feature update profile ${profileId}: ${response.status}`);
  }

  return toFeatureUpdateProfile(await response.json());
}

export interface CreateFeatureUpdateProfileInput {
  displayName: string;
  description?: string;
  featureUpdateVersion: string;
  installLatestWindows10OnWindows11IneligibleDevice?: boolean;
  installFeatureUpdatesOptional?: boolean;
}

export async function createFeatureUpdateProfile(
  token: string,
  input: CreateFeatureUpdateProfileInput
): Promise<FeatureUpdateProfile> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, 3);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to create feature update profile: ${response.status} ${body}`);
  }

  return toFeatureUpdateProfile(await response.json());
}

export async function deleteFeatureUpdateProfile(token: string, profileId: string): Promise<void> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}/${profileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }, 3);

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete feature update profile ${profileId}: ${response.status}`);
  }
}

export async function assignFeatureUpdateProfile(
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
    throw new Error(`Failed to assign feature update profile ${profileId}: ${response.status} ${body}`);
  }
}

export async function listFeatureUpdateProfileAssignments(
  token: string,
  profileId: string
): Promise<AssignmentTarget[]> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}/${profileId}/assignments`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, 3);

  if (!response.ok) {
    throw new Error(`Failed to list assignments for feature update profile ${profileId}: ${response.status}`);
  }

  const data: { value?: Array<{ target: AssignmentTarget }> } = await response.json();
  return (data.value || []).map((a) => a.target);
}
