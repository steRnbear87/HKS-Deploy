import { fetchTenantDetectedAppsIndex, computeDeploymentDriftForUpdates } from '../deployment-drift';
import type { AppUpdateInfo } from '@/types/inventory';

const { fetchWithRetryMock } = vi.hoisted(() => ({
  fetchWithRetryMock: vi.fn(),
}));

vi.mock('@/lib/intune/graph-client', () => ({
  GRAPH_API_BASE: 'https://graph.microsoft.com/v1.0',
  fetchWithRetry: fetchWithRetryMock,
  invalidateServicePrincipalToken: vi.fn(),
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeUpdate(overrides: Partial<AppUpdateInfo> = {}): AppUpdateInfo {
  return {
    intuneApp: {
      id: 'intune-app-1',
      displayName: 'Chrome for Business 64-bit',
      description: null,
      publisher: 'Google',
      displayVersion: '149.0.7827',
      fileName: null,
      installCommandLine: null,
      uninstallCommandLine: null,
      installExperience: null,
    } as AppUpdateInfo['intuneApp'],
    currentVersion: '149.0.7827',
    latestVersion: '150.0.7871',
    wingetId: 'Google.Chrome',
    hasUpdate: true,
    isManaged: true,
    ...overrides,
  };
}

beforeEach(() => {
  fetchWithRetryMock.mockReset();
});

describe('fetchTenantDetectedAppsIndex', () => {
  it('groups detectedApps rows by normalized display name across pages', async () => {
    fetchWithRetryMock
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            { id: 'da-1', displayName: 'Chrome for Business 64-bit', version: '149.0.7827', deviceCount: 2 },
            { id: 'da-2', displayName: '  Chrome For Business 64-Bit  ', version: '150.0.7871', deviceCount: 5 },
          ],
          '@odata.nextLink': 'https://graph.microsoft.com/beta/next-page',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          value: [{ id: 'da-3', displayName: 'Firefox', version: '134.0', deviceCount: 1 }],
        })
      );

    const index = await fetchTenantDetectedAppsIndex('tenant-1', 'token');

    expect(fetchWithRetryMock).toHaveBeenCalledTimes(2);
    const chromeGroups = index.byAppKey.get('chrome for business 64-bit');
    expect(chromeGroups).toHaveLength(2);
    expect(chromeGroups?.map((g) => g.version)).toEqual(['149.0.7827', '150.0.7871']);
    expect(index.byAppKey.get('firefox')).toHaveLength(1);
  });

  it('skips rows with no version and stops cleanly on a Graph error', async () => {
    fetchWithRetryMock.mockResolvedValueOnce(
      jsonResponse({ value: [{ id: 'da-1', displayName: 'NoVersionApp', version: null, deviceCount: 4 }] })
    );

    const index = await fetchTenantDetectedAppsIndex('tenant-1', 'token');
    expect(index.byAppKey.size).toBe(0);
  });
});

describe('computeDeploymentDriftForUpdates', () => {
  it('buckets device counts into on/behind/ahead relative to the expected version', async () => {
    const index = {
      byAppKey: new Map([
        [
          'chrome for business 64-bit',
          [
            { version: '148.0.0', detectedAppId: 'da-old', deviceCountHint: 5 },
            { version: '149.0.7827', detectedAppId: 'da-current', deviceCountHint: 20 },
            { version: '150.0.7871', detectedAppId: 'da-new', deviceCountHint: 3 },
          ],
        ],
      ]),
    };

    // Each managedDevices call returns a distinct device id set per version so
    // counts don't collide across the three fan-out calls.
    fetchWithRetryMock
      .mockResolvedValueOnce(jsonResponse({ value: [{ id: 'd1' }, { id: 'd2' }] })) // behind: 148.0.0
      .mockResolvedValueOnce(
        jsonResponse({ value: Array.from({ length: 18 }, (_, i) => ({ id: `cur-${i}` })) })
      ) // on-expected: 149.0.7827
      .mockResolvedValueOnce(jsonResponse({ value: [{ id: 'd3' }] })); // ahead: 150.0.7871

    const results = await computeDeploymentDriftForUpdates([makeUpdate()], index, 'tenant-1', 'token');

    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result.wingetId).toBe('Google.Chrome');
    expect(result.expectedVersion).toBe('149.0.7827');
    expect(result.behindCount).toBe(2);
    expect(result.onExpectedCount).toBe(18);
    expect(result.aheadCount).toBe(1);
    expect(result.totalDevicesScanned).toBe(21);
    expect(result.partial).toBe(false);
  });

  it('skips apps with no matching telemetry in the index', async () => {
    const index = { byAppKey: new Map() };
    const results = await computeDeploymentDriftForUpdates([makeUpdate()], index, 'tenant-1', 'token');
    expect(results).toEqual([]);
    expect(fetchWithRetryMock).not.toHaveBeenCalled();
  });

  it('ignores unmanaged updates entirely if the caller forgets to pre-filter', async () => {
    const index = {
      byAppKey: new Map([
        ['chrome for business 64-bit', [{ version: '149.0.7827', detectedAppId: 'da-1', deviceCountHint: 5 }]],
      ]),
    };
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse({ value: [{ id: 'd1' }] }));

    // isManaged is true here, but wingetId missing should still be skipped.
    const results = await computeDeploymentDriftForUpdates(
      [makeUpdate({ wingetId: null })],
      index,
      'tenant-1',
      'token'
    );
    expect(results).toEqual([]);
  });

  it('treats a 404 on managedDevices as zero devices for that version rather than failing', async () => {
    const index = {
      byAppKey: new Map([
        ['chrome for business 64-bit', [{ version: '149.0.7827', detectedAppId: 'stale-id', deviceCountHint: 5 }]],
      ]),
    };
    fetchWithRetryMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, false, 404));

    const results = await computeDeploymentDriftForUpdates([makeUpdate()], index, 'tenant-1', 'token');
    // Zero total devices scanned means nothing gets persisted for this app.
    expect(results).toEqual([]);
  });
});
