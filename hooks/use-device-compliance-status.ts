'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';
import type { DeviceComplianceStatusResponse } from '@/types/devices';

export function useDeviceComplianceStatus(deviceId: string) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<DeviceComplianceStatusResponse>({
    queryKey: [
      'devices',
      'compliance-status',
      deviceId,
      isMspUser ? selectedTenantId || 'primary' : 'self',
    ],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/intune/devices/${deviceId}/compliance-status`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch compliance status');
      }

      return response.json();
    },
    enabled: isAuthenticated && !!deviceId,
    staleTime: 2 * 60 * 1000,
  });
}
