'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMspOptional } from '@/hooks/useMspOptional';
import type {
  UpdateRing,
  FeatureUpdateProfile,
  QualityUpdateProfile,
  DriverUpdateProfile,
  DriverInventoryItem,
  DriverInventoryItemWithProfile,
  FeatureUpdateCatalogItem,
  QualityUpdateCatalogItem,
  DeviceWindowsUpdateAssignments,
} from '@/types/windows-updates';
import type { CreateUpdateRingInput } from '@/lib/intune/windows-update-rings';
import type { CreateFeatureUpdateProfileInput } from '@/lib/intune/windows-feature-updates';
import type { CreateQualityUpdateProfileInput } from '@/lib/intune/windows-quality-updates';
import type { CreateDriverUpdateProfileInput } from '@/lib/intune/windows-driver-updates';

function useAuthHeaders() {
  const { getAccessToken } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return async () => {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
    };
  };
}

export function useUpdateRings() {
  const buildHeaders = useAuthHeaders();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<{ rings: UpdateRing[]; count: number }>({
    queryKey: ['windows-updates', 'rings', isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const headers = await buildHeaders();
      const response = await fetch('/api/intune/windows-updates/rings', { headers });
      if (!response.ok) throw new Error('Failed to fetch update rings');
      return response.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateUpdateRing() {
  const buildHeaders = useAuthHeaders();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateUpdateRingInput) => {
      const headers = await buildHeaders();
      const response = await fetch('/api/intune/windows-updates/rings', {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create update ring');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['windows-updates', 'rings'] });
    },
  });
}

export function useFeatureUpdateProfiles() {
  const buildHeaders = useAuthHeaders();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<{ profiles: FeatureUpdateProfile[]; count: number }>({
    queryKey: ['windows-updates', 'feature-profiles', isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const headers = await buildHeaders();
      const response = await fetch('/api/intune/windows-updates/feature-profiles', { headers });
      if (!response.ok) throw new Error('Failed to fetch feature update profiles');
      return response.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateFeatureUpdateProfile() {
  const buildHeaders = useAuthHeaders();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateFeatureUpdateProfileInput) => {
      const headers = await buildHeaders();
      const response = await fetch('/api/intune/windows-updates/feature-profiles', {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create feature update profile');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['windows-updates', 'feature-profiles'] });
    },
  });
}

export function useQualityUpdateProfiles() {
  const buildHeaders = useAuthHeaders();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<{ profiles: QualityUpdateProfile[]; count: number }>({
    queryKey: ['windows-updates', 'quality-profiles', isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const headers = await buildHeaders();
      const response = await fetch('/api/intune/windows-updates/quality-profiles', { headers });
      if (!response.ok) throw new Error('Failed to fetch quality update profiles');
      return response.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateQualityUpdateProfile() {
  const buildHeaders = useAuthHeaders();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateQualityUpdateProfileInput) => {
      const headers = await buildHeaders();
      const response = await fetch('/api/intune/windows-updates/quality-profiles', {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create quality update profile');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['windows-updates', 'quality-profiles'] });
    },
  });
}

export function useDriverUpdateProfiles() {
  const buildHeaders = useAuthHeaders();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<{ profiles: DriverUpdateProfile[]; count: number }>({
    queryKey: ['windows-updates', 'driver-profiles', isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const headers = await buildHeaders();
      const response = await fetch('/api/intune/windows-updates/driver-profiles', { headers });
      if (!response.ok) throw new Error('Failed to fetch driver update profiles');
      return response.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateDriverUpdateProfile() {
  const buildHeaders = useAuthHeaders();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateDriverUpdateProfileInput) => {
      const headers = await buildHeaders();
      const response = await fetch('/api/intune/windows-updates/driver-profiles', {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create driver update profile');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['windows-updates', 'driver-profiles'] });
    },
  });
}

export function useDriverInventory(profileId: string | null) {
  const buildHeaders = useAuthHeaders();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<{ drivers: DriverInventoryItem[]; count: number }>({
    queryKey: ['windows-updates', 'driver-profiles', profileId, 'drivers', isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const headers = await buildHeaders();
      const response = await fetch(`/api/intune/windows-updates/driver-profiles/${profileId}/drivers`, { headers });
      if (!response.ok) throw new Error('Failed to fetch driver inventory');
      return response.json();
    },
    enabled: !!profileId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useSetDriverApprovalStatus() {
  const buildHeaders = useAuthHeaders();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      profileId: string;
      driverId: string;
      approvalStatus: DriverInventoryItem['approvalStatus'];
    }) => {
      const headers = await buildHeaders();
      const response = await fetch(
        `/api/intune/windows-updates/driver-profiles/${input.profileId}/drivers/${input.driverId}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ approvalStatus: input.approvalStatus }),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to update driver approval status');
      }
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['windows-updates', 'driver-profiles', variables.profileId, 'drivers'],
      });
    },
  });
}

export function useUpdateCatalog() {
  const buildHeaders = useAuthHeaders();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<{ feature: FeatureUpdateCatalogItem[]; quality: QualityUpdateCatalogItem[] }>({
    queryKey: ['windows-updates', 'catalog', isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const headers = await buildHeaders();
      const response = await fetch('/api/intune/windows-updates/catalog', { headers });
      if (!response.ok) throw new Error('Failed to fetch Windows Update release catalog');
      return response.json();
    },
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useAllDriverInventory() {
  const buildHeaders = useAuthHeaders();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<{ drivers: DriverInventoryItemWithProfile[]; count: number }>({
    queryKey: ['windows-updates', 'driver-inventory-all', isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const headers = await buildHeaders();
      const response = await fetch('/api/intune/windows-updates/driver-profiles/inventory', { headers });
      if (!response.ok) throw new Error('Failed to fetch driver inventory');
      return response.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useDeviceWindowsUpdateAssignments(deviceId: string | null) {
  const buildHeaders = useAuthHeaders();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<DeviceWindowsUpdateAssignments>({
    queryKey: ['windows-updates', 'device', deviceId, isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const headers = await buildHeaders();
      const response = await fetch(`/api/intune/windows-updates/device/${deviceId}`, { headers });
      if (!response.ok) throw new Error('Failed to fetch device Windows Update assignments');
      return response.json();
    },
    enabled: !!deviceId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

interface AssignDeviceUpdatePolicyInput {
  deviceId: string;
  policyType: 'ring' | 'feature' | 'quality' | 'driver';
  policyId: string | null;
  azureADDeviceId: string;
  deviceName: string;
}

export function useAssignDeviceUpdatePolicy() {
  const buildHeaders = useAuthHeaders();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AssignDeviceUpdatePolicyInput) => {
      const headers = await buildHeaders();
      const response = await fetch(`/api/intune/windows-updates/device/${input.deviceId}/assign`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          policyType: input.policyType,
          policyId: input.policyId,
          azureADDeviceId: input.azureADDeviceId,
          deviceName: input.deviceName,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to update device Windows Update assignment');
      }
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['windows-updates', 'device', variables.deviceId] });
    },
  });
}
