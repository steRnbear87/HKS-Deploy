/**
 * SnapshotCatalogSource tests.
 *
 * Builds a real catalog snapshot file from mock rows using buildSqlite (the
 * same builder the production snapshot pipeline uses), points
 * CATALOG_SNAPSHOT_FILE at it, and asserts the source's behavior matches the
 * SupabaseCatalogSource semantics it replaces.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSqlite } from '../../scripts/build-catalog-snapshot.mjs';
import { SnapshotCatalogSource } from './snapshot-source';
import { _resetSnapshotStoreForTest } from './snapshot-store';

let tmpDir: string;
let dbPath: string;

const curatedApps = [
  {
    id: 1,
    winget_id: 'Google.Chrome',
    name: 'Google Chrome',
    publisher: 'Google LLC',
    latest_version: '120.0',
    description: 'Fast web browser',
    homepage: 'https://google.com',
    license: 'Proprietary',
    tags: ['browser', 'web'],
    category: 'Browsers',
    is_verified: true,
    is_locale_variant: false,
    popularity_rank: 1,
    app_source: 'winget',
    has_icon: true,
    winget_last_update: '2026-01-01T00:00:00Z',
  },
  {
    id: 2,
    winget_id: 'Mozilla.Firefox',
    name: 'Mozilla Firefox',
    publisher: 'Mozilla',
    latest_version: '121.0',
    description: 'Open source browser',
    license: 'MPL-2.0',
    tags: ['browser'],
    category: 'Browsers',
    is_verified: true,
    is_locale_variant: false,
    popularity_rank: 2,
    app_source: 'winget',
    winget_last_update: '2026-06-01T00:00:00Z',
  },
  {
    id: 3,
    winget_id: 'Zoom.Zoom',
    name: 'Zoom Workplace',
    publisher: 'Zoom',
    latest_version: '6.0',
    tags: null,
    category: 'Communication',
    is_verified: true,
    is_locale_variant: false,
    popularity_rank: 5,
    app_source: 'chocolatey',
  },
  {
    id: 5,
    winget_id: 'Some.Uncategorized',
    name: 'Mystery App',
    publisher: 'Acme',
    latest_version: '1.0',
    tags: null,
    category: null,
    is_verified: true,
    is_locale_variant: false,
    popularity_rank: 20,
    app_source: 'winget',
  },
  {
    id: 4,
    winget_id: 'Google.Chrome.de',
    name: 'Google Chrome (German)',
    publisher: 'Google LLC',
    latest_version: '120.0',
    category: 'Browsers',
    is_verified: true,
    is_locale_variant: true,
    parent_winget_id: 'Google.Chrome',
    locale_code: 'de',
    popularity_rank: 10,
  },
];

const versionHistory = [
  {
    winget_id: 'Google.Chrome',
    version: '120.0',
    installer_url: 'https://x/chrome.msi',
    installer_sha256: 'abc',
    installer_type: 'msi',
    installer_scope: 'machine',
    installers: [{ Architecture: 'x64', InstallerUrl: 'https://x/chrome.msi' }],
    created_at: '2026-01-02T00:00:00Z',
  },
  {
    winget_id: 'Google.Chrome',
    version: '119.0',
    installer_url: 'https://x/chrome119.msi',
    installer_sha256: 'def',
    installer_type: 'msi',
    installers: [{ Architecture: 'x64', InstallerUrl: 'https://x/chrome119.msi' }],
    created_at: '2026-01-01T00:00:00Z',
  },
];

const sccmMappings = [
  {
    id: 'm1',
    sccm_display_name_normalized: 'google chrome',
    sccm_ci_id: '123',
    sccm_product_code: null,
    winget_package_id: 'Google.Chrome',
    winget_package_name: 'Google Chrome',
    confidence: 1,
    is_verified: true,
  },
];

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'snapshot-source-test-'));
  dbPath = path.join(tmpDir, 'catalog.sqlite');
  buildSqlite(dbPath, { curatedApps, versionHistory, sccmMappings });
  process.env.CATALOG_SNAPSHOT_FILE = dbPath;
  _resetSnapshotStoreForTest();
});

afterEach(() => {
  // keep the same open handle across assertions; nothing to reset per-test
});

afterAll(() => {
  _resetSnapshotStoreForTest();
  delete process.env.CATALOG_SNAPSHOT_FILE;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('SnapshotCatalogSource', () => {
  const source = new SnapshotCatalogSource();

  it('searchApps("chrome") returns the Chrome row (FTS path)', async () => {
    const { data, error } = await source.searchApps('chrome', { limit: 10 });
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const ids = (data || []).map((r) => r.winget_id);
    expect(ids).toContain('Google.Chrome');
    // locale variant must be excluded
    expect(ids).not.toContain('Google.Chrome.de');
    // tags parsed back to an array
    const chrome = (data || []).find((r) => r.winget_id === 'Google.Chrome');
    expect(chrome?.tags).toEqual(['browser', 'web']);
    expect(chrome?.installer_type).toBeNull();
  });

  it('searchApps falls back to ILIKE for non-FTS-matching publisher terms', async () => {
    const { data } = await source.searchApps('Mozilla', { limit: 10 });
    const ids = (data || []).map((r) => r.winget_id);
    expect(ids).toContain('Mozilla.Firefox');
  });

  it('getPopularApps orders by popularity and counts verified non-variant apps', async () => {
    const result = await source.getPopularApps({
      limit: 10,
      offset: 0,
      sort: 'popular',
    });
    expect(result).not.toBeNull();
    expect(result?.data[0].winget_id).toBe('Google.Chrome');
    // 4 verified non-variant apps (locale variant excluded)
    expect(result?.total).toBe(4);
  });

  it('getPopularPackages returns popularity-ordered rows', async () => {
    const { data, error } = await source.getPopularPackages(10);
    expect(error).toBeNull();
    expect((data || [])[0].winget_id).toBe('Google.Chrome');
  });

  it('getCategories returns per-category counts', async () => {
    const cats = await source.getCategories();
    const browsers = cats.find((c) => c.category === 'Browsers');
    // Google.Chrome, Mozilla.Firefox, Google.Chrome.de are all verified Browsers
    expect(browsers?.count).toBe(3);
    const comms = cats.find((c) => c.category === 'Communication');
    expect(comms?.count).toBe(1);
  });

  it('getAppByWingetId returns versions (newest first) and locale variants', async () => {
    const details = await source.getAppByWingetId('Google.Chrome');
    expect(details).not.toBeNull();
    expect(details?.app.winget_id).toBe('Google.Chrome');
    expect(details?.versions).toEqual(['120.0', '119.0']);
    expect(details?.app.tags).toEqual(['browser', 'web']);
    expect(details?.localeVariants?.[0].wingetId).toBe('Google.Chrome.de');
    expect(details?.localeVariants?.[0].localeCode).toBe('de');
  });

  it('getVersionInstallerInfo parses installers JSON', async () => {
    const info = await source.getVersionInstallerInfo('Google.Chrome', '120.0');
    expect(info?.installer_url).toBe('https://x/chrome.msi');
    expect(Array.isArray(info?.installers)).toBe(true);
    expect((info?.installers as Array<{ Architecture: string }>)[0].Architecture).toBe('x64');
  });

  it('getLatestVersionInstallerInfo returns the row for a version', async () => {
    const info = await source.getLatestVersionInstallerInfo('Google.Chrome', '119.0');
    expect(info?.installer_url).toBe('https://x/chrome119.msi');
  });

  it('getInstallationChangelog returns null (not shipped in snapshot)', async () => {
    expect(await source.getInstallationChangelog('Google.Chrome')).toBeNull();
  });

  it('getAllLatestVersions returns rows with non-null latest_version', async () => {
    const all = await source.getAllLatestVersions();
    const map = new Map(all.map((r) => [r.winget_id, r.latest_version]));
    expect(map.get('Google.Chrome')).toBe('120.0');
    expect(map.get('Mozilla.Firefox')).toBe('121.0');
  });

  it('getAppsByWingetIds returns latest versions for the given ids', async () => {
    const rows = await source.getAppsByWingetIds(['Google.Chrome', 'Zoom.Zoom']);
    const map = new Map(rows.map((r) => [r.winget_id, r.latest_version]));
    expect(map.get('Google.Chrome')).toBe('120.0');
    expect(map.get('Zoom.Zoom')).toBe('6.0');
    expect(map.size).toBe(2);
  });

  it('getSccmMapping("google chrome") resolves to Google.Chrome via mapping', async () => {
    const result = await source.getSccmMapping(
      { displayNameNormalized: 'google chrome', ciId: 'unknown', productCode: null },
      'tenant-xyz'
    );
    expect(result?.status).toBe('matched');
    expect(result?.wingetId).toBe('Google.Chrome');
    expect(result?.wingetName).toBe('Google Chrome');
    expect(result?.matchedBy).toBe('mapping');
    expect(result?.mappingId).toBe('m1');
  });

  it('searchCuratedAppsForMatching returns CuratedAppMatch shape', async () => {
    const matches = await source.searchCuratedAppsForMatching('chrome');
    expect(matches[0]).toMatchObject({
      wingetId: 'Google.Chrome',
      name: 'Google Chrome',
      publisher: 'Google LLC',
      latestVersion: '120.0',
    });
  });

  it('existence checks behave like the Supabase source', async () => {
    expect(await source.appExists('Google.Chrome')).toBe(true);
    expect(await source.appExists('Does.NotExist')).toBe(false);
    expect(await source.appExistsCaseInsensitive('google.chrome')).toEqual({
      winget_id: 'Google.Chrome',
    });
    const similar = await source.findSimilarVerifiedApps('chrome', 5);
    expect(similar.map((a) => a.winget_id)).toContain('Google.Chrome');
  });

  it('getCatalogStats counts all curated apps', async () => {
    const stats = await source.getCatalogStats();
    expect(stats.totalApps).toBe(5);
  });

  it('getCategoryCount respects verifiedOnly', async () => {
    expect(await source.getCategoryCount({ verifiedOnly: true })).toBe(5);
    expect(await source.getCategoryCount({ verifiedOnly: false })).toBe(5);
  });

  it('getUncategorizedCount counts verified non-variant apps with no category', async () => {
    expect(await source.getUncategorizedCount()).toBe(1);
  });

  it('getPopularApps filters: multi-select categories', async () => {
    const result = await source.getPopularApps({
      limit: 10,
      offset: 0,
      sort: 'popular',
      filters: { categories: ['Communication', 'Browsers'] },
    });
    // Browsers: Chrome, Firefox (Chrome.de locale variant excluded) + Communication: Zoom
    expect(result?.total).toBe(3);
  });

  it('getPopularApps filters: needsCategorization', async () => {
    const result = await source.getPopularApps({
      limit: 10,
      offset: 0,
      sort: 'popular',
      filters: { needsCategorization: true },
    });
    expect(result?.total).toBe(1);
    expect(result?.data[0].winget_id).toBe('Some.Uncategorized');
  });

  it('getPopularApps filters: publisher substring match', async () => {
    const result = await source.getPopularApps({
      limit: 10,
      offset: 0,
      sort: 'popular',
      filters: { publisher: 'Mozilla' },
    });
    expect(result?.total).toBe(1);
    expect(result?.data[0].winget_id).toBe('Mozilla.Firefox');
  });

  it('getPopularApps filters: raw tag search', async () => {
    const result = await source.getPopularApps({
      limit: 10,
      offset: 0,
      sort: 'popular',
      filters: { tag: 'web' },
    });
    expect(result?.data.map((r) => r.winget_id)).toEqual(['Google.Chrome']);
  });

  it('getPopularApps filters: license bucket', async () => {
    const result = await source.getPopularApps({
      limit: 10,
      offset: 0,
      sort: 'popular',
      filters: { licenseBuckets: ['open-source'] },
    });
    expect(result?.data.map((r) => r.winget_id)).toEqual(['Mozilla.Firefox']);
  });

  it('getPopularApps filters: app source', async () => {
    const result = await source.getPopularApps({
      limit: 10,
      offset: 0,
      sort: 'popular',
      filters: { appSources: ['chocolatey'] },
    });
    expect(result?.data.map((r) => r.winget_id)).toEqual(['Zoom.Zoom']);
  });

  it('getPopularApps filters: includeLocaleVariants', async () => {
    const withVariants = await source.getPopularApps({
      limit: 10,
      offset: 0,
      sort: 'popular',
      filters: { includeLocaleVariants: true, categories: ['Browsers'] },
    });
    expect(withVariants?.total).toBe(3);
    const withoutVariants = await source.getPopularApps({
      limit: 10,
      offset: 0,
      sort: 'popular',
      filters: { categories: ['Browsers'] },
    });
    expect(withoutVariants?.total).toBe(2);
  });

  it('getPopularApps filters: installer type (joined from version_history)', async () => {
    const result = await source.getPopularApps({
      limit: 10,
      offset: 0,
      sort: 'popular',
      filters: { installerTypes: ['msi'] },
    });
    // Only Google.Chrome's latest_version (120.0) row has installer_type 'msi' in version_history
    expect(result?.data.map((r) => r.winget_id)).toEqual(['Google.Chrome']);
  });

  it('getPopularApps sort: newest orders by winget_last_update desc', async () => {
    const result = await source.getPopularApps({
      limit: 10,
      offset: 0,
      sort: 'newest',
      filters: { categories: ['Browsers'] },
    });
    expect(result?.data.map((r) => r.winget_id)).toEqual(['Mozilla.Firefox', 'Google.Chrome']);
  });
});
