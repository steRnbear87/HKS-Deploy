'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';
import type { ReportResult } from '@/types/reports';

/**
 * Fetches a single report's data by id. `enabled` defaults to false - the
 * catalog grid only opens one report at a time, so this should be gated on
 * "this specific card is expanded," not fetched for every card up front.
 */
export function useReport(reportId: string, options?: { enabled?: boolean }) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<ReportResult>({
    queryKey: ['reports', reportId, isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to run report');
      }

      return response.json();
    },
    enabled: isAuthenticated && (options?.enabled ?? false),
    staleTime: 5 * 60 * 1000,
  });
}
