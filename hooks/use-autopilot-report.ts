'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';
import type { AutopilotReportResponse } from '@/types/autopilot';

export function useAutopilotReport(options?: { enabled?: boolean }) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<AutopilotReportResponse>({
    queryKey: ['autopilot', 'report', isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/intune/reports/autopilot', {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch Autopilot report');
      }

      return response.json();
    },
    enabled: isAuthenticated && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
