'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';

export interface FleetAppInventoryEntry {
  displayName: string;
  publisher: string | null;
  deviceCount: number;
}

export interface FleetAppInventoryResponse {
  apps: FleetAppInventoryEntry[];
  devicesTotal: number | null;
  snapshotDate: string | null;
  capturedAt: string | null;
  partial: boolean;
  hasHistory: boolean;
}

export function useFleetAppInventory() {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<FleetAppInventoryResponse>({
    queryKey: ['devices', 'app-inventory-summary', isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch('/api/intune/devices/app-inventory-summary', {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch fleet app inventory');
      }

      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
}
