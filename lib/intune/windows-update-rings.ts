/**
 * Windows Update Rings (windowsUpdateForBusinessConfiguration)
 *
 * v1.0 resource under deviceManagement/deviceConfigurations. Controls quality/
 * feature update deferral, pause, and deadlines. Assignment is group-only -
 * see lib/intune/device-update-groups.ts for the per-device workaround.
 */

import { GRAPH_API_BASE, fetchWithRetry } from './graph-client';
import type { UpdateRing } from '@/types/windows-updates';
import type { AssignmentTarget } from '@/types/intune';

const ODATA_TYPE = '#microsoft.graph.windowsUpdateForBusinessConfiguration';

interface GraphDeviceConfigListResponse {
  value: Array<Record<string, unknown>>;
}

function toUpdateRing(raw: Record<string, unknown>): UpdateRing {
  return {
    id: raw.id as string,
    displayName: raw.displayName as string,
    description: (raw.description as string) || undefined,
    qualityUpdatesDeferralPeriodInDays: (raw.qualityUpdatesDeferralPeriodInDays as number) ?? 0,
    featureUpdatesDeferralPeriodInDays: (raw.featureUpdatesDeferralPeriodInDays as number) ?? 0,
    qualityUpdatesPaused: Boolean(raw.qualityUpdatesPaused),
    featureUpdatesPaused: Boolean(raw.featureUpdatesPaused),
    deadlineForQualityUpdatesInDays: raw.deadlineForQualityUpdatesInDays as number | undefined,
    deadlineForFeatureUpdatesInDays: raw.deadlineForFeatureUpdatesInDays as number | undefined,
    deadlineGracePeriodInDays: raw.deadlineGracePeriodInDays as number | undefined,
    automaticUpdateMode: raw.automaticUpdateMode as string | undefined,
    businessReadyUpdatesOnly: raw.businessReadyUpdatesOnly as string | undefined,
    createdDateTime: raw.createdDateTime as string | undefined,
    lastModifiedDateTime: raw.lastModifiedDateTime as string | undefined,
  };
}

/** Lists only windowsUpdateForBusinessConfiguration rows - deviceConfigurations
 * is a shared collection with many unrelated profile types (compliance,
 * device restrictions, etc.), filtered by @odata.type. */
export async function listUpdateRings(token: string): Promise<UpdateRing[]> {
  const url = `${GRAPH_API_BASE}/deviceManagement/deviceConfigurations?$filter=${encodeURIComponent(
    `isof('${ODATA_TYPE.replace('#', '')}')`
  )}`;
  const response = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, 3);

  if (!response.ok) {
    throw new Error(`Failed to list update rings: ${response.status}`);
  }

  const data: GraphDeviceConfigListResponse = await response.json();
  return (data.value || []).map(toUpdateRing);
}

export async function getUpdateRing(token: string, ringId: string): Promise<UpdateRing> {
  const response = await fetchWithRetry(
    `${GRAPH_API_BASE}/deviceManagement/deviceConfigurations/${ringId}`,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    3
  );

  if (!response.ok) {
    throw new Error(`Failed to get update ring ${ringId}: ${response.status}`);
  }

  return toUpdateRing(await response.json());
}

export interface CreateUpdateRingInput {
  displayName: string;
  description?: string;
  qualityUpdatesDeferralPeriodInDays: number;
  featureUpdatesDeferralPeriodInDays: number;
  qualityUpdatesPaused?: boolean;
  featureUpdatesPaused?: boolean;
  deadlineForQualityUpdatesInDays?: number;
  deadlineForFeatureUpdatesInDays?: number;
  deadlineGracePeriodInDays?: number;
}

export async function createUpdateRing(token: string, input: CreateUpdateRingInput): Promise<UpdateRing> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE}/deviceManagement/deviceConfigurations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      '@odata.type': ODATA_TYPE,
      displayName: input.displayName,
      description: input.description,
      qualityUpdatesDeferralPeriodInDays: input.qualityUpdatesDeferralPeriodInDays,
      featureUpdatesDeferralPeriodInDays: input.featureUpdatesDeferralPeriodInDays,
      qualityUpdatesPaused: input.qualityUpdatesPaused ?? false,
      featureUpdatesPaused: input.featureUpdatesPaused ?? false,
      deadlineForQualityUpdatesInDays: input.deadlineForQualityUpdatesInDays,
      deadlineForFeatureUpdatesInDays: input.deadlineForFeatureUpdatesInDays,
      deadlineGracePeriodInDays: input.deadlineGracePeriodInDays,
    }),
  }, 3);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to create update ring: ${response.status} ${body}`);
  }

  return toUpdateRing(await response.json());
}

export async function updateUpdateRing(
  token: string,
  ringId: string,
  input: Partial<CreateUpdateRingInput>
): Promise<void> {
  const response = await fetchWithRetry(
    `${GRAPH_API_BASE}/deviceManagement/deviceConfigurations/${ringId}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ '@odata.type': ODATA_TYPE, ...input }),
    },
    3
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to update ring ${ringId}: ${response.status} ${body}`);
  }
}

export async function deleteUpdateRing(token: string, ringId: string): Promise<void> {
  const response = await fetchWithRetry(
    `${GRAPH_API_BASE}/deviceManagement/deviceConfigurations/${ringId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    3
  );

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete ring ${ringId}: ${response.status}`);
  }
}

/** Full assignment replace - Graph's assign action always replaces the
 * complete assignment set, so callers must pass the full desired list, not
 * a delta. Used both for the by-device flow (one groupAssignmentTarget) and
 * any future bulk-assign UI (multiple targets). */
export async function assignUpdateRing(
  token: string,
  ringId: string,
  targets: AssignmentTarget[]
): Promise<void> {
  const response = await fetchWithRetry(
    `${GRAPH_API_BASE}/deviceManagement/deviceConfigurations/${ringId}/assign`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignments: targets.map((target) => ({ target })),
      }),
    },
    3
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to assign ring ${ringId}: ${response.status} ${body}`);
  }
}

export async function listUpdateRingAssignments(
  token: string,
  ringId: string
): Promise<AssignmentTarget[]> {
  const response = await fetchWithRetry(
    `${GRAPH_API_BASE}/deviceManagement/deviceConfigurations/${ringId}/assignments`,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    3
  );

  if (!response.ok) {
    throw new Error(`Failed to list assignments for ring ${ringId}: ${response.status}`);
  }

  const data: { value?: Array<{ target: AssignmentTarget }> } = await response.json();
  return (data.value || []).map((a) => a.target);
}
