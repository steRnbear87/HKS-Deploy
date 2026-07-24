'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';
import type {
  DeviceLogCollectionListResponse,
  DeviceLogCollectionRequest,
  DeviceLogDownloadUrlResponse,
} from '@/types/devices';

/** List past/pending diagnostic log collection requests for a device. */
export function useDeviceLogs(deviceId: string) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<DeviceLogCollectionListResponse>({
    queryKey: ['devices', 'logs', deviceId, isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/intune/devices/${deviceId}/logs`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch log collection requests');
      }

      return response.json();
    },
    enabled: isAuthenticated && !!deviceId,
    // Poll every 5s while a request is still pending; otherwise don't poll.
    refetchInterval: (query) => {
      const requests = query.state.data?.requests;
      const hasPending = requests?.some((r) => r.status === 'pending');
      return hasPending ? 5000 : false;
    },
  });
}

/** Kick off a new full diagnostic log collection for a device. */
export function useRequestDeviceLogCollection(deviceId: string) {
  const { getAccessToken } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();
  const queryClient = useQueryClient();

  return useMutation<{ request: DeviceLogCollectionRequest }, Error, void>({
    mutationFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/intune/devices/${deviceId}/logs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start log collection');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices', 'logs', deviceId] });
    },
  });
}

/** Get a signed download URL for a completed log collection request. */
export function useDeviceLogDownloadUrl(deviceId: string) {
  const { getAccessToken } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useMutation<DeviceLogDownloadUrlResponse, Error, string>({
    mutationFn: async (requestId: string) => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/intune/devices/${deviceId}/logs/${requestId}/download`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create download link');
      }

      return response.json();
    },
  });
}
