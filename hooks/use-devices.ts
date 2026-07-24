'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';
import type { ManagedDevicesResponse, ManagedDeviceDetailResponse } from '@/types/devices';

export function useDevices(options?: { enabled?: boolean }) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<ManagedDevicesResponse>({
    queryKey: ['devices', 'list', isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/intune/devices', {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch devices');
      }

      return response.json();
    },
    enabled: isAuthenticated && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useDeviceDetails(deviceId: string | null) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<ManagedDeviceDetailResponse>({
    queryKey: ['devices', 'detail', deviceId, isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      if (!deviceId) {
        throw new Error('No device ID provided');
      }

      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`/api/intune/devices/${deviceId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch device details');
      }

      return response.json();
    },
    enabled: isAuthenticated && !!deviceId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}
