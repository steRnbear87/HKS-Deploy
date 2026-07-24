'use client';

import { Sparkles } from 'lucide-react';

/**
 * Placeholder for live per-app Intune install status. The synchronous Graph
 * endpoint this was originally built against (mobileApps/{id}/deviceStatuses)
 * has been retired; a working version needs the async
 * deviceManagement/reports/exportJobs flow instead. Parked until that rework
 * lands - see lib/intune/install-status.ts.
 */
export function InstallStatusPanel() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-12 h-12 rounded-full bg-accent-cyan/10 flex items-center justify-center mb-3">
        <Sparkles className="w-6 h-6 text-accent-cyan" />
      </div>
      <p className="text-text-primary font-medium">Coming soon</p>
      <p className="text-sm text-text-muted mt-1 max-w-md">
        Real device install counts pulled directly from Microsoft Intune, per app.
      </p>
    </div>
  );
}
