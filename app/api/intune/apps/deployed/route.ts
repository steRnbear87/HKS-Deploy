import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { getDatabase } from '@/lib/db';

// Approximate "all" for self-hosted SQLite installs, which need an explicit
// limit (unlike the unbounded Supabase queries this route used previously).
const SELF_HOSTED_SCAN_LIMIT = 1000;

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
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

    const db = getDatabase();

    // scope=tenant returns every user's IntuneGet deployments in the tenant
    // (with attribution) so the cart can warn about apps a teammate already
    // deployed. packaging_jobs carries user_email; upload_history does not.
    const scope = new URL(request.url).searchParams.get('scope');
    if (scope === 'tenant') {
      const tenantJobs = await db.jobs.getByTenantId(tenantId, SELF_HOSTED_SCAN_LIMIT);

      const byWingetId = new Map<string, string | null>();
      for (const job of tenantJobs) {
        if (job.status === 'deployed' && job.winget_id && !byWingetId.has(job.winget_id)) {
          byWingetId.set(job.winget_id, job.user_email);
        }
      }

      const tenantDeployments = Array.from(byWingetId, ([wingetId, deployedBy]) => ({
        wingetId,
        deployedBy,
      }));

      return NextResponse.json({
        tenantDeployments,
        deployedWingetIds: tenantDeployments.map((d) => d.wingetId),
        count: tenantDeployments.length,
        scope: 'tenant',
      });
    }

    const userHistory = await db.uploadHistory.getByUserId(user.userId, SELF_HOSTED_SCAN_LIMIT);

    const deployedWingetIds = Array.from(
      new Set(
        userHistory
          .filter((row) => row.intune_tenant_id === tenantId)
          .map((row) => row.winget_id)
          .filter(Boolean)
      )
    );

    return NextResponse.json({
      deployedWingetIds,
      count: deployedWingetIds.length,
    });
  } catch (error) {
    console.error('[GET /api/intune/apps/deployed] Unhandled error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
