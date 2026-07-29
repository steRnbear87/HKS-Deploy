'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';
import type { DeviceActionRequest, DeviceActionResponse, DeviceRemoteAction } from '@/types/devices';

/** Fire a simple remote action (sync, reboot, shutdown) or a Company Portal notification. */
export function useDeviceAction(deviceId: string) {
  const { getAccessToken } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();
  const queryClient = useQueryClient();

  return useMutation<DeviceActionResponse, Error, DeviceActionRequest>({
    mutationFn: async (payload: DeviceActionRequest) => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/intune/devices/${deviceId}/actions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to perform device action');
      }

      return response.json();
    },
    onSuccess: (_data, payload) => {
      // A sync in particular changes device state Intune will report back
      // soon (lastSyncDateTime, compliance); refresh detail view.
      if (payload.action === 'sync') {
        queryClient.invalidateQueries({ queryKey: ['devices', 'detail', deviceId] });
      }
    },
  });
}

export type { DeviceRemoteAction };
