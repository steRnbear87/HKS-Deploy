import { NextRequest } from 'next/server';

const {
  parseAccessTokenMock,
  createServerClientMock,
  resolveTargetTenantIdMock,
  getUpdateCheckResultsByUserIdMock,
  getUploadHistoryByUserIdMock,
  getDeploymentDriftByUserIdMock,
} = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  createServerClientMock: vi.fn(),
  resolveTargetTenantIdMock: vi.fn(),
  getUpdateCheckResultsByUserIdMock: vi.fn(),
  getUploadHistoryByUserIdMock: vi.fn(),
  getDeploymentDriftByUserIdMock: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: createServerClientMock,
  isSupabaseConfigured: () => true,
}));

vi.mock('@/lib/msp/tenant-resolution', () => ({
  resolveTargetTenantId: resolveTargetTenantIdMock,
}));

// The route reads update_check_results/upload_history via the DB adapter
// (works in both Supabase and self-hosted SQLite mode) rather than a raw
// Supabase query - mock it directly instead of routing through the real
// getDatabase(), which pulls in a dynamic require() that doesn't resolve
// under Vitest's transform. app_update_policies stays Supabase-only (no
// SQLite equivalent), so that part still goes through createServerClientMock.
vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    updateCheckResults: { getByUserId: getUpdateCheckResultsByUserIdMock },
    uploadHistory: { getByUserId: getUploadHistoryByUserIdMock },
    deploymentDrift: { getByUserId: getDeploymentDriftByUserIdMock },
  }),
}));

import { GET } from '@/app/api/updates/available/route';

function createAwaitableQuery(
  result: { data: unknown; error: unknown },
  operations: Array<{ method: string; args: unknown[] }>
) {
  const query: Record<string, unknown> = {};

  query.select = (...args: unknown[]) => {
    operations.push({ method: 'select', args });
    return query;
  };
  query.eq = (...args: unknown[]) => {
    operations.push({ method: 'eq', args });
    return query;
  };
  query.order = (...args: unknown[]) => {
    operations.push({ method: 'order', args });
    return query;
  };
  query.is = (...args: unknown[]) => {
    operations.push({ method: 'is', args });
    return query;
  };
  query.in = (...args: unknown[]) => {
    operations.push({ method: 'in', args });
    return query;
  };
  query.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve(result).then(resolve);

  return query;
}

describe('GET /api/updates/available', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUpdateCheckResultsByUserIdMock.mockResolvedValue([]);
    getUploadHistoryByUserIdMock.mockResolvedValue([]);
    getDeploymentDriftByUserIdMock.mockResolvedValue([]);
    resolveTargetTenantIdMock.mockImplementation(
      async ({ requestedTenantId, tokenTenantId }: { requestedTenantId: string | null; tokenTenantId: string }) => ({
        tenantId: requestedTenantId || tokenTenantId,
        errorResponse: null,
      })
    );
  });

  it('applies tenant filter to updates and policy lookup', async () => {
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'home-tenant',
      userName: 'User',
    });

    getUpdateCheckResultsByUserIdMock.mockResolvedValue([
      {
        id: 'upd-1',
        user_id: 'user-1',
        tenant_id: 'tenant-a',
        winget_id: 'Microsoft.Edge',
        intune_app_id: 'app-1',
        display_name: 'Edge',
        current_version: '1.0.0',
        latest_version: '1.1.0',
        is_critical: true,
        is_managed: true,
        detected_at: '2026-02-01T00:00:00Z',
        notified_at: null,
        dismissed_at: null,
      },
    ]);

    const policyOps: Array<{ method: string; args: unknown[] }> = [];

    const policiesQuery = createAwaitableQuery(
      {
        data: [
          {
            id: 'pol-1',
            winget_id: 'Microsoft.Edge',
            tenant_id: 'tenant-a',
            policy_type: 'notify',
            is_enabled: true,
            pinned_version: null,
            last_auto_update_at: null,
            consecutive_failures: 0,
          },
        ],
        error: null,
      },
      policyOps
    );

    createServerClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'app_update_policies') return policiesQuery;
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    const request = new NextRequest(
      'http://localhost:3000/api/updates/available?tenant_id=tenant-a'
    );
    request.headers.set('Authorization', 'Bearer test-token');

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.criticalCount).toBe(1);
    expect(body.updates[0].policy?.id).toBe('pol-1');

    expect(getUpdateCheckResultsByUserIdMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ tenantId: 'tenant-a' })
    );
    expect(
      policyOps.some(
        (op) => op.method === 'eq' && op.args[0] === 'tenant_id' && op.args[1] === 'tenant-a'
      )
    ).toBe(true);
  });

  it('hides unmanaged updates by default and includes them on request', async () => {
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'home-tenant',
      userName: 'User',
    });

    getUpdateCheckResultsByUserIdMock.mockResolvedValue([
      {
        id: 'upd-managed',
        user_id: 'user-1',
        tenant_id: 'tenant-a',
        winget_id: 'Microsoft.Edge',
        intune_app_id: 'app-1',
        display_name: 'Edge',
        current_version: '1.0.0',
        latest_version: '1.1.0',
        is_critical: false,
        is_managed: true,
        detected_at: '2026-02-01T00:00:00Z',
        notified_at: null,
        dismissed_at: null,
      },
      {
        id: 'upd-unmanaged',
        user_id: 'user-1',
        tenant_id: 'tenant-a',
        winget_id: 'VideoLAN.VLC',
        intune_app_id: 'app-2',
        display_name: 'VLC',
        current_version: '2.0.0',
        latest_version: '2.1.0',
        is_critical: false,
        is_managed: false,
        detected_at: '2026-02-01T00:00:00Z',
        notified_at: null,
        dismissed_at: null,
      },
    ]);

    createServerClientMock.mockImplementation(() => ({
      from: (table: string) => {
        if (table === 'app_update_policies')
          return createAwaitableQuery({ data: [], error: null }, []);
        throw new Error(`Unexpected table: ${table}`);
      },
    }));

    // Default: unmanaged hidden
    const defaultReq = new NextRequest('http://localhost:3000/api/updates/available');
    defaultReq.headers.set('Authorization', 'Bearer test-token');
    const defaultBody = await (await GET(defaultReq)).json();
    expect(defaultBody.count).toBe(1);
    expect(defaultBody.updates[0].winget_id).toBe('Microsoft.Edge');
    expect(defaultBody.updates[0].is_managed).toBe(true);

    // include_unmanaged=true: both managed and unmanaged shown
    const allReq = new NextRequest(
      'http://localhost:3000/api/updates/available?include_unmanaged=true'
    );
    allReq.headers.set('Authorization', 'Bearer test-token');
    const allBody = await (await GET(allReq)).json();
    expect(allBody.count).toBe(2);
  });
});
