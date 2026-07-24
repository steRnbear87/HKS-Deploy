'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';

export interface DeviceHealthTrendPoint {
  date: string;
  totalDevices: number;
  compliantCount: number;
  noncompliantCount: number;
  staleCount: number;
  partial: boolean;
}

export interface DeviceHealthTrendResponse {
  points: DeviceHealthTrendPoint[];
  latestCapturedAt: string | null;
  hasHistory: boolean;
}

export function useDeviceHealthTrend(days: number = 30) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<DeviceHealthTrendResponse>({
    queryKey: ['devices', 'health-trend', days, isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/intune/devices/health-trend?days=${days}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch device health trend');
      }

      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
}
