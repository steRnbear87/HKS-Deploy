/**
 * Driver inventory aggregated across every Driver Update Profile - powers
 * the Release Catalog section's "Driver Updates" count/list without
 * requiring the user to pick a profile first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import { listDriverUpdateProfiles, listDriverInventory } from '@/lib/intune/windows-driver-updates';
import type { DriverInventoryItemWithProfile } from '@/types/windows-updates';

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const profiles = await listDriverUpdateProfiles(token);
    const perProfile = await Promise.all(
      profiles.map(async (profile) => {
        const drivers = await listDriverInventory(token, profile.id);
        return drivers.map((driver): DriverInventoryItemWithProfile => ({
          ...driver,
          profileId: profile.id,
          profileName: profile.displayName,
        }));
      })
    );

    const drivers = perProfile.flat();
    return NextResponse.json({ drivers, count: drivers.length });
  } catch (error) {
    console.error('[GET /api/intune/windows-updates/driver-profiles/inventory] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to load driver inventory' }, { status: 500 });
  }
}
