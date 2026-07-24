'use client';

import { useCallback } from 'react';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMspOptional } from '@/hooks/useMspOptional';
import type { AppInstallStatusResponse } from '@/types/inventory';

/**
 * Fetches live per-app install status from Intune on demand. Imperative
 * rather than an eager useQuery: triggered by the user picking an app in the
 * Reports panel, not on mount, since each call fans out a Graph pagination
 * scan that can take tens of seconds for large device counts.
 */
export function useInstallStatus() {
  const { getAccessToken } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  const fetchInstallStatus = useCallback(
    async (appId: string): Promise<AppInstallStatusResponse> => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Authentication failed. Please sign in again.');
      }

      let response: Response;
      try {
        // The route bounds its own Graph scan to ~40s; this timeout only
        // covers a stalled request so the panel never spins forever.
        response = await fetch(`/api/intune/apps/${encodeURIComponent(appId)}/install-status`, {
          signal: AbortSignal.timeout(60_000),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
          },
        });
      } catch (err) {
        if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
          throw new Error('The install status request timed out. Please try again in a moment.');
        }
        throw err;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to load install status');
      }

      return response.json();
    },
    [getAccessToken, isMspUser, selectedTenantId]
  );

  return { fetchInstallStatus };
}
