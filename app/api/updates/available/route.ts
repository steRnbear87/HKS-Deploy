/**
 * Available Updates API Route
 * GET - Get all available updates with policy information
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
import { compareVersions } from '@/lib/version-compare';
import { getDatabase } from '@/lib/db';
import type { AvailableUpdate } from '@/types/update-policies';

/**
 * GET /api/updates/available
 * Get all available updates for the user, with policy information
 */
export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const requestedTenantId = searchParams.get('tenant_id')?.trim() || null;
    const includeDismissed = searchParams.get('include_dismissed') === 'true';
    const criticalOnly = searchParams.get('critical_only') === 'true';
    // By default only surface updates for IntuneGet-managed apps; fuzzy-matched
    // apps are opt-in to avoid accidentally updating mismatched/customized apps.
    const includeUnmanaged = searchParams.get('include_unmanaged') === 'true';

    let tenantId = user.tenantId;
    if (isSupabaseConfigured()) {
      const supabase = createServerClient();

      const tenantResolution = await resolveTargetTenantId({
        supabase,
        userId: user.userId,
        tokenTenantId: user.tenantId,
        requestedTenantId,
      });

      if (tenantResolution.errorResponse) {
        return tenantResolution.errorResponse;
      }

      tenantId = tenantResolution.tenantId;
    } else if (requestedTenantId) {
      tenantId = requestedTenantId;
    }

    const db = getDatabase();
    const updates = await db.updateCheckResults.getByUserId(user.userId, {
      tenantId,
      includeDismissed,
      criticalOnly,
    });

    if (updates.length === 0) {
      return NextResponse.json({
        updates: [],
        count: 0,
        criticalCount: 0,
      });
    }

    const wingetIds = [...new Set(updates.map((u) => u.winget_id))];

    // Policy info (ignore/pin/auto-update tracking) is Supabase-only - no
    // policies exist in self-hosted mode, so every update is unrestricted.
    const policyMap = new Map<string, AvailableUpdate['policy']>();
    if (isSupabaseConfigured()) {
      const supabase = createServerClient();
      let policiesQuery = supabase
        .from('app_update_policies')
        .select('id, winget_id, tenant_id, policy_type, is_enabled, pinned_version, last_auto_update_at, last_auto_update_version, consecutive_failures')
        .eq('user_id', user.userId)
        .in('winget_id', wingetIds);

      if (tenantId) {
        policiesQuery = policiesQuery.eq('tenant_id', tenantId);
      }

      const { data: policies } = await policiesQuery;
      policies?.forEach((policy) => {
        const key = `${policy.winget_id}:${policy.tenant_id}`;
        policyMap.set(key, {
          id: policy.id,
          policy_type: policy.policy_type,
          is_enabled: policy.is_enabled,
          pinned_version: policy.pinned_version,
          last_auto_update_at: policy.last_auto_update_at,
          last_auto_update_version: policy.last_auto_update_version,
          consecutive_failures: policy.consecutive_failures,
        });
      });
    }

    // Determine which apps were deployed through IntuneGet, for has_prior_deployment.
    const deployedSet = new Set<string>();
    const uploadHistory = await db.uploadHistory.getByUserId(user.userId, 500);
    for (const record of uploadHistory) {
      if (wingetIds.includes(record.winget_id)) {
        deployedSet.add(`${record.winget_id}:${record.intune_tenant_id}`);
      }
    }

    // Rollout/drift status, computed daily by the cron for managed apps only
    // (see lib/intune/deployment-drift.ts) - keyed by the exact Intune app
    // object drift was scanned against, same key update_check_results uses.
    const driftRows = await db.deploymentDrift.getByUserId(user.userId, { tenantId });
    const driftMap = new Map(driftRows.map((row) => [`${row.winget_id}:${row.intune_app_id}`, row]));

    // Combine updates with policy info and filter out Unknown versions
    const updatesWithPolicies: AvailableUpdate[] = updates
      .map((update) => {
        const policyKey = `${update.winget_id}:${update.tenant_id}`;
        const driftRow = driftMap.get(`${update.winget_id}:${update.intune_app_id}`);
        return {
          ...update,
          is_managed: update.is_managed ?? true,
          has_prior_deployment: deployedSet.has(policyKey),
          policy: policyMap.get(policyKey) || null,
          rollout: driftRow
            ? {
                expectedVersion: driftRow.expected_version,
                totalScanned: driftRow.total_devices_scanned,
                onExpected: driftRow.on_expected_count,
                behind: driftRow.behind_count,
                ahead: driftRow.ahead_count,
                partial: driftRow.partial,
                scannedAt: driftRow.scanned_at,
              }
            : null,
        };
      })
      .filter((u) => u.current_version !== 'Unknown')
      .filter((u) => compareVersions(u.current_version, u.latest_version) < 0)
      .filter((u) => u.policy?.last_auto_update_version !== u.latest_version)
      .filter((u) => includeUnmanaged || u.is_managed);

    // Count critical updates
    const criticalCount = updatesWithPolicies.filter((u) => u.is_critical).length;

    return NextResponse.json({
      updates: updatesWithPolicies,
      count: updatesWithPolicies.length,
      criticalCount,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/updates/available
 * Dismiss or un-dismiss updates
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { update_ids, action } = body;

    if (!update_ids || !Array.isArray(update_ids) || update_ids.length === 0) {
      return NextResponse.json(
        { error: 'update_ids array is required' },
        { status: 400 }
      );
    }

    if (!['dismiss', 'restore'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "dismiss" or "restore"' },
        { status: 400 }
      );
    }

    const updated = await getDatabase().updateCheckResults.setDismissed(
      update_ids,
      user.userId,
      action === 'dismiss'
    );

    return NextResponse.json({
      success: true,
      updated,
      action,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
