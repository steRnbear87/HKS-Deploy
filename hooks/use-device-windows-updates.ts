'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';
import type { WindowsUpdatesResponse } from '@/types/devices';

export function useDeviceWindowsUpdates(deviceId: string, azureADDeviceId: string | null) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<WindowsUpdatesResponse>({
    queryKey: [
      'devices',
      'windows-updates',
      deviceId,
      isMspUser ? selectedTenantId || 'primary' : 'self',
    ],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const params = new URLSearchParams();
      if (azureADDeviceId) params.set('azureADDeviceId', azureADDeviceId);

      const response = await fetch(`/api/intune/devices/${deviceId}/windows-updates?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch Windows Update status');
      }

      return response.json();
    },
    enabled: isAuthenticated && !!deviceId,
    staleTime: 5 * 60 * 1000,
  });
}
