'use client';

import type { MspContextValue } from '@/types/msp';

/**
 * MSP multi-tenant management was removed (HKS runs a single tenant); this
 * always returns the "no MSP" defaults so the ~15 hooks/components that read
 * isMspUser/selectedTenantId for query keys and the X-MSP-Tenant-Id header
 * keep working unchanged.
 */
export function useMspOptional(): MspContextValue {
  return {
    organization: null,
    stats: null,
    isMspUser: false,
    accessMode: 'full',
    isLoadingOrganization: false,
    managedTenants: [],
    isLoadingTenants: false,
    selectedTenantId: null,
    selectedTenant: null,
    refreshOrganization: async () => {},
    createOrganization: async () => {
      throw new Error('MSP support has been removed');
    },
    refreshTenants: async () => {},
    addTenant: async () => {
      throw new Error('MSP support has been removed');
    },
    removeTenant: async () => {
      throw new Error('MSP support has been removed');
    },
    selectTenant: () => {},
    clearSelection: () => {},
  };
}
