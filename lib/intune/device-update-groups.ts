/**
 * Per-device Windows Update targeting via auto-managed single-device groups.
 *
 * Intune's Windows Update Graph resources (windowsUpdateForBusinessConfiguration
 * update rings, windowsFeatureUpdateProfile, windowsQualityUpdateProfile,
 * windowsDriverUpdateProfile) only support group-based assignment - confirmed
 * against current Microsoft Learn docs, there is no per-device target type
 * anywhere in that hierarchy. "Assign policy X to device Y" is implemented
 * here as "ensure a dedicated group exists for device Y, then assign policy X
 * to that group" - the standard Intune-admin workaround, done automatically.
 *
 * One group per device, reused across every Windows Update policy type
 * assigned to it (not one group per policy type), tracked in the
 * device_update_groups table so repeated assignments don't create duplicates.
 */

import { getDatabase } from '@/lib/db';
import { GRAPH_API_BASE, fetchWithRetry, getServicePrincipalToken } from './graph-client';

const GROUP_NAME_PREFIX = 'HKS-Device-';

function sanitizeForGroupName(value: string): string {
  // Entra ID group displayName/mailNickname tolerate most characters, but
  // keep this conservative (alphanumeric + hyphen) so the group is easy to
  // find/read in the admin center and mailNickname rules are never a concern.
  return value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 48) || 'Device';
}

interface EntraDeviceObject {
  id: string;
}

/**
 * Resolve an Entra ID device object's directory object id (the `id` field
 * used for group membership calls) from its `deviceId` GUID (what Intune
 * calls azureADDeviceId on managedDevice). These are two different fields on
 * the same Entra `device` resource - looking this up wrong silently fails
 * the member-add call with the wrong id.
 */
export async function resolveEntraDeviceObjectId(token: string, azureADDeviceId: string): Promise<string> {
  const url = `${GRAPH_API_BASE}/devices?$filter=${encodeURIComponent(`deviceId eq '${azureADDeviceId}'`)}&$select=id`;
  const response = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }, 3);

  if (!response.ok) {
    throw new Error(`Failed to resolve Entra device object for ${azureADDeviceId}: ${response.status}`);
  }

  const data: { value?: EntraDeviceObject[] } = await response.json();
  const match = data.value?.[0];
  if (!match) {
    throw new Error(`No Entra ID device object found for azureADDeviceId ${azureADDeviceId}`);
  }
  return match.id;
}

async function createDeviceGroup(token: string, deviceId: string, deviceName: string): Promise<string> {
  const slug = sanitizeForGroupName(deviceName);
  const shortId = deviceId.replace(/-/g, '').slice(0, 8);
  const displayName = `${GROUP_NAME_PREFIX}${slug}-${shortId}`;

  const response = await fetchWithRetry(`${GRAPH_API_BASE}/groups`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName,
      mailEnabled: false,
      mailNickname: `hks-device-${shortId}`,
      securityEnabled: true,
      description:
        'Auto-managed by HKS App Deployment for per-device Windows Update targeting. ' +
        'Do not delete or edit membership manually.',
    }),
  }, 3);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to create device update group: ${response.status} ${body}`);
  }

  const group: { id: string } = await response.json();
  return group.id;
}

/** Best-effort cleanup for a group this process created but lost the race
 * to persist (see ensureDeviceUpdateGroup) - never thrown, only logged, so
 * a cleanup failure doesn't surface as an error on what is otherwise a
 * successful assignment. */
async function deleteDeviceGroupBestEffort(token: string, groupId: string): Promise<void> {
  try {
    const response = await fetchWithRetry(`${GRAPH_API_BASE}/groups/${groupId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }, 3);
    if (!response.ok && response.status !== 404) {
      const body = await response.text().catch(() => '');
      console.error(`[device-update-groups] Failed to clean up orphaned group ${groupId}: ${response.status} ${body}`);
    }
  } catch (error) {
    console.error(`[device-update-groups] Failed to clean up orphaned group ${groupId}:`, error);
  }
}

async function addDeviceToGroup(token: string, groupId: string, deviceObjectId: string): Promise<void> {
  const response = await fetchWithRetry(`${GRAPH_API_BASE}/groups/${groupId}/members/$ref`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      '@odata.id': `${GRAPH_API_BASE}/directoryObjects/${deviceObjectId}`,
    }),
  }, 3);

  // 400 with "already exist" happens if a previous attempt partially
  // succeeded (group created, membership add failed, retried later) - treat
  // as success rather than surfacing a confusing error on retry.
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 400 && body.includes('already exist')) return;
    throw new Error(`Failed to add device to update group: ${response.status} ${body}`);
  }
}

// Dedupes concurrent ensureDeviceUpdateGroup calls for the same device
// within this process (e.g. a double-clicked assign, or two policy types
// assigned back-to-back before the first group finishes being created) so
// only one of them actually creates a group in Entra. This does not cover
// two different server instances racing on the same device at the same
// moment - that residual case is handled by the post-upsert reconciliation
// below, which cleans up whichever group loses.
const inFlightCreates = new Map<string, Promise<{ groupId: string }>>();

/**
 * Get-or-create the single-device Entra ID group used to target this device
 * with Windows Update policies. Safe to call repeatedly - reuses the stored
 * mapping once created.
 */
export async function ensureDeviceUpdateGroup(
  tenantId: string,
  deviceId: string,
  azureADDeviceId: string,
  deviceName: string
): Promise<{ groupId: string }> {
  const db = getDatabase();
  const existing = await db.deviceUpdateGroups.getByDeviceId(tenantId, deviceId);
  if (existing) {
    return { groupId: existing.entra_group_id };
  }

  const lockKey = `${tenantId}:${deviceId}`;
  const inFlight = inFlightCreates.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const create = (async (): Promise<{ groupId: string }> => {
    const token = await getServicePrincipalToken(tenantId);
    if (!token) {
      throw new Error(`Failed to get Graph token for tenant ${tenantId}`);
    }

    const deviceObjectId = await resolveEntraDeviceObjectId(token, azureADDeviceId);
    const groupId = await createDeviceGroup(token, deviceId, deviceName);
    await addDeviceToGroup(token, groupId, deviceObjectId);

    const persisted = await db.deviceUpdateGroups.upsert({
      tenant_id: tenantId,
      device_id: deviceId,
      azure_ad_device_id: azureADDeviceId,
      entra_group_id: groupId,
    });

    // A different process could have upserted its own group for this
    // device between our getByDeviceId check and this upsert. If the
    // persisted row doesn't point at the group we just created, we lost
    // that race - delete our now-orphaned group and use the winner.
    if (persisted.entra_group_id !== groupId) {
      await deleteDeviceGroupBestEffort(token, groupId);
      return { groupId: persisted.entra_group_id };
    }

    return { groupId };
  })();

  inFlightCreates.set(lockKey, create);
  try {
    return await create;
  } finally {
    inFlightCreates.delete(lockKey);
  }
}
