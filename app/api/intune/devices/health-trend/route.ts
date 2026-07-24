/**
 * Fleet Health Trend API Route
 *
 * Serves the daily device-health snapshots captured by
 * lib/device-health/snapshot.ts. Graph itself has no history - this reads
 * our own rollup table, not Graph.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
import { getDatabase } from '@/lib/db';

function clampDays(raw: string | null): number {
  const parsed = raw ? parseInt(raw, 10) : 30;
  if (Number.isNaN(parsed)) return 30;
  return Math.min(365, Math.max(1, parsed));
}

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

    const days = clampDays(request.nextUrl.searchParams.get('days'));
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const db = getDatabase();
    const [snapshots, latest] = await Promise.all([
      db.deviceHealthSnapshots.getByTenantId(tenantId, sinceDate),
      db.deviceHealthSnapshots.getLatest(tenantId),
    ]);

    return NextResponse.json({
      points: snapshots.map((s) => ({
        date: s.snapshot_date,
        totalDevices: s.total_devices,
        compliantCount: s.compliant_count,
        noncompliantCount: s.noncompliant_count,
        staleCount: s.stale_count,
        partial: s.partial,
      })),
      latestCapturedAt: latest?.captured_at ?? null,
      hasHistory: snapshots.length > 0,
    });
  } catch (error) {
    console.error('Error in device health-trend route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch device health trend' },
      { status: 500 }
    );
  }
}
