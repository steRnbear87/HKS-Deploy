/**
 * Windows Update release catalog - Microsoft-published feature and quality
 * update releases (read-only reference data, not tenant-specific config).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import { resolveAuthenticatedTenant } from '@/lib/intune/windows-updates-route-auth';
import { listFeatureUpdateCatalog, listQualityUpdateCatalog } from '@/lib/intune/windows-update-catalog';

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthenticatedTenant(request);
    if ('errorResponse' in auth) return auth.errorResponse;

    const token = await getServicePrincipalToken(auth.tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    const [feature, quality] = await Promise.all([
      listFeatureUpdateCatalog(token),
      listQualityUpdateCatalog(token),
    ]);

    return NextResponse.json({ feature, quality });
  } catch (error) {
    console.error('[GET /api/intune/windows-updates/catalog] Unhandled error:', error);
    return NextResponse.json({ error: 'Failed to load Windows Update release catalog' }, { status: 500 });
  }
}
