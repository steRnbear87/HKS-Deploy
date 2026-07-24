import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { getDatabase } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const wingetId = searchParams.get('wingetId');

    if (!wingetId) {
      return NextResponse.json(
        { error: 'wingetId parameter required' },
        { status: 400 }
      );
    }

    // MSP tenant resolution is a Supabase-only (hosted) concern; self-hosted
    // SQLite installs use the signed-in user's own tenant.
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

    // Get the most recent successfully deployed job's package_config
    const db = getDatabase();
    const userJobs = await db.jobs.getByUserId(user.userId, 200);
    const latestJob = userJobs
      .filter((j) => j.tenant_id === tenantId && j.winget_id === wingetId && j.status === 'deployed')
      .sort((a, b) => new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime())[0];

    if (!latestJob) {
      return NextResponse.json({
        config: null,
        deployedAt: null,
        intuneAppId: null,
      });
    }

    return NextResponse.json({
      config: latestJob.package_config,
      deployedAt: latestJob.completed_at,
      intuneAppId: latestJob.intune_app_id || null,
    });
  } catch (error) {
    console.error('[GET /api/intune/apps/deployed/config] Unhandled error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
