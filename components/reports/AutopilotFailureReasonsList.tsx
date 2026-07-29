'use client';

import { AlertCircle } from 'lucide-react';
import type { AutopilotFailureReasonCount } from '@/types/autopilot';

interface AutopilotFailureReasonsListProps {
  failureReasons: AutopilotFailureReasonCount[];
}

const STATUS_LABELS: Record<string, string> = {
  failed: 'Deployment profile assignment failed',
  assignedOutOfSync: 'Assigned, out of sync',
  assignedUnkownSyncState: 'Assigned, sync state unknown',
  unknown: 'Unknown reason',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function AutopilotFailureReasonsList({ failureReasons }: AutopilotFailureReasonsListProps) {
  if (!failureReasons || failureReasons.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-text-muted text-sm">
        No enrollment failures reported
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {failureReasons.map((reason) => (
        <div
          key={reason.status}
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-status-error/5 border border-status-error/10"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-status-error flex-shrink-0" />
            <span className="text-sm text-text-secondary truncate">{statusLabel(reason.status)}</span>
          </div>
          <span className="text-sm font-medium text-text-primary tabular-nums flex-shrink-0 ml-3">
            {reason.count}
          </span>
        </div>
      ))}
    </div>
  );
}
