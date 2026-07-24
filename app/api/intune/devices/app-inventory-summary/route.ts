/**
 * Fleet App Inventory Summary API Route
 *
 * Serves the daily "top installed apps" snapshots captured by
 * lib/device-health/app-inventory-snapshot.ts. No live Graph call here -
 * this reads our own rollup table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
import { getDatabase } from '@/lib/db';

const DEFAULT_LIMIT = 10;

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let tenantId = user.tenantId;
    if (isSupabaseConfigured()) {
      const supabase = createServerClient();
      const mspTenantId = request.headers.get('X-MSP-Tenant-Id');

      const tenantResolution = await resolveTargetTenantId({
        supabase,
        userId: user.userId,
        tokenTenantId: user.tenantId,
        requestedTenantId: mspTenantId,
      });

      if (tenantResolution.errorResponse) {
        return tenantResolution.errorResponse;
      }

      tenantId = tenantResolution.tenantId;
    }

    const rows = await getDatabase().fleetAppInventory.getLatestForTenant(tenantId, DEFAULT_LIMIT);

    return NextResponse.json({
      apps: rows.map((row) => ({
        displayName: row.display_name,
        publisher: row.publisher,
        deviceCount: row.device_count,
      })),
      devicesTotal: rows[0]?.devices_total ?? null,
      snapshotDate: rows[0]?.snapshot_date ?? null,
      capturedAt: rows[0]?.captured_at ?? null,
      partial: rows[0]?.partial ?? false,
      hasHistory: rows.length > 0,
    });
  } catch (error) {
    console.error('Error in fleet app-inventory-summary route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch fleet app inventory' },
      { status: 500 }
    );
  }
}
