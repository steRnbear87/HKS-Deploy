'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';
import type { DeviceAppInventoryResponse } from '@/types/devices';

export function useDeviceAppInventory(deviceId: string) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<DeviceAppInventoryResponse>({
    queryKey: [
      'devices',
      'app-inventory',
      deviceId,
      isMspUser ? selectedTenantId || 'primary' : 'self',
    ],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/intune/devices/${deviceId}/detected-apps`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch installed apps');
      }

      return response.json();
    },
    enabled: isAuthenticated && !!deviceId,
    staleTime: 5 * 60 * 1000,
  });
}
