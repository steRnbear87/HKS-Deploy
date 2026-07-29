/**
 * Windows Quality Update Profiles (windowsQualityUpdateProfile)
 *
 * Beta-only resource under deviceManagement/windowsQualityUpdateProfiles -
 * pushes a specific cumulative update release, optionally expedited
 * (expeditedUpdateSettings). Assignment is group-only - see
 * lib/intune/device-update-groups.ts for the per-device workaround. Real
 * per-device targeting for expedited updates exists separately via Windows
 * Autopatch (lib/intune/windows-autopatch.ts) when the tenant has it enabled.
 */

import { fetchWithRetry, fetchAllGraphPages } from './graph-client';
import type { QualityUpdateProfile } from '@/types/windows-updates';
import type { AssignmentTarget } from '@/types/intune';

const GRAPH_API_BASE_BETA = 'https://graph.microsoft.com/beta';
const RESOURCE = 'deviceManagement/windowsQualityUpdateProfiles';

function toQualityUpdateProfile(raw: Record<string, unknown>): QualityUpdateProfile {
  const expedited = raw.expeditedUpdateSettings as
    | { qualityUpdateRelease?: string; daysUntilForcedReboot?: number }
    | undefined;
  return {
    id: raw.id as string,
    displayName: raw.displayName as string,
    description: (raw.description as string) || undefined,
    releaseDateDisplayName: raw.releaseDateDisplayName as string | undefined,
    deployableContentDisplayName: raw.deployableContentDisplayName as string | undefined,
    expedited: expedited
      ? {
          qualityUpdateRelease: expedited.qualityUpdateRelease,
          daysUntilForcedReboot: expedited.daysUntilForcedReboot,
        }
      : undefined,
    createdDateTime: raw.createdDateTime as string | undefined,
    lastModifiedDateTime: raw.lastModifiedDateTime as string | undefined,
  };
}

export async function listQualityUpdateProfiles(token: string): Promise<QualityUpdateProfile[]> {
  const rows = await fetchAllGraphPages<Record<string, unknown>>(
    `${GRAPH_API_BASE_BETA}/${RESOURCE}`,
    token,
    'Failed to list quality update profiles'
  );
  return rows.map(toQualityUpdateProfile);
}

export async function getQualityUpdateProfile(token: string, profileId: string): Promise<QualityUpdateProfile> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}/${profileId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, 3);

  if (!response.ok) {
    throw new Error(`Failed to get quality update profile ${profileId}: ${response.status}`);
  }

  return toQualityUpdateProfile(await response.json());
}

export interface CreateQualityUpdateProfileInput {
  displayName: string;
  description?: string;
  releaseDateDisplayName?: string;
  expedited?: {
    qualityUpdateRelease: string;
    daysUntilForcedReboot: number;
  };
}

export async function createQualityUpdateProfile(
  token: string,
  input: CreateQualityUpdateProfileInput
): Promise<QualityUpdateProfile> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: input.displayName,
      description: input.description,
      releaseDateDisplayName: input.releaseDateDisplayName,
      expeditedUpdateSettings: input.expedited
        ? {
            qualityUpdateRelease: input.expedited.qualityUpdateRelease,
            daysUntilForcedReboot: input.expedited.daysUntilForcedReboot,
          }
        : undefined,
    }),
  }, 3);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to create quality update profile: ${response.status} ${body}`);
  }

  return toQualityUpdateProfile(await response.json());
}

export async function deleteQualityUpdateProfile(token: string, profileId: string): Promise<void> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/${RESOURCE}/${profileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }, 3);

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete quality update profile ${profileId}: ${response.status}`);
  }
}

export async function assignQualityUpdateProfile(
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
    throw new Error(`Failed to assign quality update profile ${profileId}: ${response.status} ${body}`);
  }
}

export async function listQualityUpdateProfileAssignments(
  token: string,
  profileId: string
): Promise<AssignmentTarget[]> {
  const rows = await fetchAllGraphPages<{ target: AssignmentTarget }>(
    `${GRAPH_API_BASE_BETA}/${RESOURCE}/${profileId}/assignments`,
    token,
    `Failed to list assignments for quality update profile ${profileId}`
  );
  return rows.map((a) => a.target);
}
