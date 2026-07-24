/**
 * Windows Autopatch enhancement for expedited quality updates.
 *
 * Windows Autopatch's admin/windows/updates API is the ONE genuine per-device
 * targeting mechanism in Intune's Windows Update stack (confirmed against
 * current Microsoft Learn docs) - deploymentAudience.members takes real
 * device object ids directly, no group workaround needed. It requires
 * Autopatch licensing/enrollment and a different Graph permission
 * (WindowsUpdates.ReadWrite.All) from the classic profile stack
 * (DeviceManagementConfiguration.ReadWrite.All), so this is opt-in and
 * auto-detected: when unavailable, callers fall back to the universal
 * single-device-group path using windowsQualityUpdateProfile's own
 * expeditedUpdateSettings (lib/intune/windows-quality-updates.ts).
 */

import { fetchWithRetry } from './graph-client';
import { resolveEntraDeviceObjectId } from './device-update-groups';

const GRAPH_API_BASE_BETA = 'https://graph.microsoft.com/beta';

// Detection result is cached per tenant - Autopatch enrollment status
// changes rarely, and probing on every assignment would add a Graph round
// trip to an otherwise-fast operation for the (common) non-Autopatch case.
const DETECTION_CACHE_TTL_MS = 60 * 60 * 1000;
const detectionCache = new Map<string, { enabled: boolean; checkedAt: number }>();

/**
 * Probes whether this tenant has Windows Autopatch's admin/windows/updates
 * API available. Fails closed (treated as disabled) on any non-2xx response -
 * a 403 here could mean either "no Autopatch license" or "app registration
 * lacks WindowsUpdates.ReadWrite.All", and either way the safe behavior is
 * the same: fall back to the universal group-based path.
 */
export async function isAutopatchEnabled(tenantId: string, token: string): Promise<boolean> {
  const cached = detectionCache.get(tenantId);
  if (cached && Date.now() - cached.checkedAt < DETECTION_CACHE_TTL_MS) {
    return cached.enabled;
  }

  let enabled = false;
  try {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE_BETA}/admin/windows/updates/deployments?$top=1`,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
      1
    );
    enabled = response.ok;
  } catch {
    enabled = false;
  }

  detectionCache.set(tenantId, { enabled, checkedAt: Date.now() });
  return enabled;
}

/** Test-only: clear the detection cache so tests don't leak state across tenants. */
export function resetAutopatchDetectionCacheForTests(): void {
  detectionCache.clear();
}

export interface ExpeditedDeploymentInput {
  qualityUpdateCatalogEntryId: string;
  daysUntilForcedReboot?: number;
  azureADDeviceIds: string[]; // managedDevice.azureADDeviceId GUIDs, resolved to object ids here
}

/**
 * Creates an Autopatch deployment targeting specific devices directly - the
 * one place in this feature that does NOT go through the single-device-group
 * workaround, since Autopatch's deploymentAudience takes real device ids.
 */
export async function createExpeditedDeploymentForDevices(
  token: string,
  input: ExpeditedDeploymentInput
): Promise<{ deploymentId: string }> {
  const deviceObjectIds = await Promise.all(
    input.azureADDeviceIds.map((id) => resolveEntraDeviceObjectId(token, id))
  );

  const response = await fetchWithRetry(`${GRAPH_API_BASE_BETA}/admin/windows/updates/deployments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      '@odata.type': '#microsoft.graph.windowsUpdates.deployment',
      content: {
        '@odata.type': '#microsoft.graph.windowsUpdates.qualityUpdateCatalogEntry',
        id: input.qualityUpdateCatalogEntryId,
      },
      settings: {
        '@odata.type': '#microsoft.graph.windowsUpdates.deploymentSettings',
        expedite: {
          '@odata.type': '#microsoft.graph.windowsUpdates.expeditedUpdateSettings',
          isExpedited: true,
          daysUntilForcedReboot: input.daysUntilForcedReboot,
        },
      },
      audience: {
        '@odata.type': '#microsoft.graph.windowsUpdates.deploymentAudience',
        members: deviceObjectIds.map((id) => ({
          '@odata.type': '#microsoft.graph.windowsUpdates.azureADDevice',
          id,
        })),
      },
    }),
  }, 3);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to create Autopatch expedited deployment: ${response.status} ${body}`);
  }

  const data: { id: string } = await response.json();
  return { deploymentId: data.id };
}
