'use client';

import { Users, Laptop, Globe } from 'lucide-react';
import { T } from 'gt-next';
import type { PolicyAssignmentSummary } from '@/types/windows-updates';

/** Read-only "who is this assigned to" line for a Windows Update policy card
 * - shared across the Rings/Feature/Quality/Driver tabs since Graph's
 * assign action never surfaces group names, only ids (resolved server-side
 * in lib/intune/windows-update-assignments.ts). */
export function AssignmentSummaryLine({ assignments }: { assignments: PolicyAssignmentSummary | undefined }) {
  if (!assignments) return null;
  const { groups, allDevices, allUsers } = assignments;

  if (groups.length === 0 && !allDevices && !allUsers) {
    return <p className="text-xs text-text-muted mt-2"><T>Not assigned</T></p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      {allDevices && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-overlay/10 text-text-secondary">
          <Laptop className="w-3 h-3" /> <T>All devices</T>
        </span>
      )}
      {allUsers && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-overlay/10 text-text-secondary">
          <Globe className="w-3 h-3" /> <T>All users</T>
        </span>
      )}
      {groups.map((group) => (
        <span
          key={group.id}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-accent-cyan/10 text-accent-cyan"
        >
          <Users className="w-3 h-3" /> {group.displayName}
        </span>
      ))}
    </div>
  );
}
