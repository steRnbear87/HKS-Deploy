'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';
import type { FleetWindowsUpdateSummary } from '@/types/devices';

export function useFleetWindowsUpdates() {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<FleetWindowsUpdateSummary>({
    queryKey: ['windows-updates', 'fleet-summary', isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch('/api/intune/windows-updates/summary', {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch fleet Windows Update summary');
      }

      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 20 * 60 * 1000,
  });
}
