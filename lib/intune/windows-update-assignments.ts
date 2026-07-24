/**
 * Resolves raw Graph assignment targets (group ids only, no names) into a
 * display-ready summary for the Windows Update policy tabs. Shared across
 * all four policy types (ring/feature/quality/driver) since Graph's assign
 * action and /assignments nav property never return group display names.
 */

import { getGroupsByIds } from '@/lib/intune-api';
import type { AssignmentTarget } from '@/types/intune';
import type { PolicyAssignmentSummary } from '@/types/windows-updates';

const GROUP_TARGET = '#microsoft.graph.groupAssignmentTarget';
const ALL_DEVICES_TARGET = '#microsoft.graph.allDevicesAssignmentTarget';
const ALL_USERS_TARGET = '#microsoft.graph.allLicensedUsersAssignmentTarget';

export async function attachAssignmentSummaries<T extends { id: string }>(
  token: string,
  items: T[],
  listAssignments: (token: string, id: string) => Promise<AssignmentTarget[]>
): Promise<Array<T & { assignments: PolicyAssignmentSummary }>> {
  const perItemTargets = await Promise.all(items.map((item) => listAssignments(token, item.id)));

  const allGroupIds = perItemTargets
    .flat()
    .filter((target) => target['@odata.type'] === GROUP_TARGET && target.groupId)
    .map((target) => target.groupId as string);

  const groups = await getGroupsByIds(token, allGroupIds);
  const nameById = new Map(groups.map((group) => [group.id, group.displayName]));

  return items.map((item, index) => {
    const targets = perItemTargets[index];
    const groupTargets = targets.filter((target) => target['@odata.type'] === GROUP_TARGET && target.groupId);
    return {
      ...item,
      assignments: {
        groups: groupTargets.map((target) => ({
          id: target.groupId as string,
          displayName: nameById.get(target.groupId as string) || target.groupId!,
        })),
        allDevices: targets.some((target) => target['@odata.type'] === ALL_DEVICES_TARGET),
        allUsers: targets.some((target) => target['@odata.type'] === ALL_USERS_TARGET),
      },
    };
  });
}
