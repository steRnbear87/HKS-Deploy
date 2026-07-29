/**
 * Supabase-backed CatalogSource.
 *
 * Each method contains the catalog query moved verbatim from its original
 * call site. The two client constructions used by the original code are
 * preserved exactly:
 *  - `serviceOrAnonClient()` -> createClient(url, SERVICE_ROLE_KEY || ANON_KEY)
 *    (used by winget-api.ts, manifest-api.ts and the winget/* routes)
 *  - `createServerClient()` -> service-role-only typed client
 *    (used by community/sccm/stats/auto-update call sites)
 *
 * Where it does not change which key is used, the original helper is reused.
 */

import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase';

/**
 * Quote a value for use inside a PostgREST `.or()` filter string. Without
 * this, a value containing a comma or parenthesis (e.g. an SCCM inventory
 * name like "Microsoft Visual C++ 2015-2022 Redistributable (x64)") breaks
 * the or() grammar - PostgREST then rejects or misparses the whole filter,
 * which callers here treat as "no match" rather than a hard error, so the
 * failure was previously silent.
 */
function quotePostgrestOrValue(value: string): string {
  return `"${value.replace(/"/g, '')}"`;
}
import { getLocaleDisplay, countryCodeToFlag } from '@/lib/locale-utils';
import type { LocaleVariant } from '@/types/winget';
import type { CuratedAppMatch } from '@/lib/app-mappings';
import type { InstallationSnapshot } from '@/lib/winget-api';
import type {
  CatalogFilterOptions,
  CatalogSource,
  CategoryCount,
  CuratedAppRpcRow,
  CuratedAppWithDetails,
  LicenseBucket,
  PopularPackagesResult,
  SccmCuratedAppRow,
  SccmMappingQuery,
  SccmMappingResult,
  SearchSort,
  VersionInstallerInfo,
  WingetIdLatestVersion,
} from './types';

/**
 * Postgres has no license_bucket column (only the SQLite snapshot computes
 * one), so bucket filtering here is approximated with the same keyword
 * families the snapshot builder's classifyLicense uses, expressed as ILIKE
 * patterns. Good enough for filtering; not a byte-for-byte match with the
 * SQLite classifier's edge cases.
 */
const LICENSE_BUCKET_ILIKE_PATTERNS: Record<LicenseBucket, string[]> = {
  'open-source': ['%mit%', '%gpl%', '%bsd%', '%apache%', '%mpl%', '%mozilla public%', '%isc%', '%zlib%', '%unlicense%', '%cc0%', '%public domain%', '%wtfpl%', '%eclipse public%', '%eupl%', '%gnu%'],
  freeware: ['%freeware%', '%freemium%', '%donationware%', '%free for personal%', '%non-commercial%', '%creative commons%'],
  proprietary: ['%proprietary%', '%commercial%', '%eula%', '%end user license%', '%all rights reserved%', '%copyright%', '%closed source%', '%trial%', '%shareware%'],
  unknown: [],
};

/** Builds a Supabase `.or()` filter string matching any pattern in `patterns` against `column`. */
function orIlike(column: string, patterns: string[]): string {
  return patterns.map((p) => `${column}.ilike.${p}`).join(',');
}

const ALL_KNOWN_LICENSE_PATTERNS = [
  ...LICENSE_BUCKET_ILIKE_PATTERNS['open-source'],
  ...LICENSE_BUCKET_ILIKE_PATTERNS.freeware,
  ...LICENSE_BUCKET_ILIKE_PATTERNS.proprietary,
];

/**
 * Builds a PostgREST `.or()` filter string for the selected license
 * buckets. Every bucket but "unknown" is a simple OR of its ILIKE keyword
 * patterns. "unknown" has no positive pattern of its own (it's defined as
 * "matches none of the others"), so selecting it previously added zero
 * patterns to the filter and the whole license-bucket filter silently
 * became a no-op (every row passed). Expressed here instead as "license is
 * null OR license doesn't match any known-bucket pattern".
 */
function buildLicenseBucketFilter(buckets: LicenseBucket[]): string | null {
  const groups: string[] = [];
  for (const bucket of buckets) {
    if (bucket === 'unknown') {
      const notConditions = ALL_KNOWN_LICENSE_PATTERNS.map((p) => `license.not.ilike.${p}`).join(',');
      groups.push(`or(license.is.null,and(${notConditions}))`);
    } else {
      const patterns = LICENSE_BUCKET_ILIKE_PATTERNS[bucket];
      if (patterns.length > 0) {
        groups.push(`or(${orIlike('license', patterns)})`);
      }
    }
  }
  return groups.length > 0 ? groups.join(',') : null;
}

/**
 * Same heuristic as scripts/build-catalog-snapshot.mjs's classifyLicense,
 * duplicated here (rather than imported) since that script is a standalone
 * Node tool and this module ships in the Next.js bundle. Used to attach a
 * license_bucket to rows read from Postgres, which has no such column.
 */
function classifyLicenseForDisplay(license: string | null | undefined): LicenseBucket {
  if (!license || !license.trim()) return 'unknown';
  const s = license.trim();
  if (/business source license|\bbusl\b|elastic[\s-]?license|elastic-\d|server side public license|\bsspl\b|polyform|fair source|fair core license|\bfsl-|functional source license|commons clause/i.test(s)) {
    return 'proprietary';
  }
  if (/\bmit\b|\bgpl\b|\bgplv?\d|general public licen[cs]e|\bagpl\b|\bagplv?\d|\blgpl\b|\blgplv?\d|\bbsd\b|0bsd|\bapache\b|\bmpl\b|\bmplv?\d|mozilla public license|\bisc\b|\bzlib\b|libpng|\bunlicense\b|\bcc0\b|creative commons zero|public domain|\bwtfpl\b|\bepl\b|eclipse public license|\beupl\b|european union public licen[cs]e|\bpsf\b|python software foundation|\bgnu\b|boost software license|bsl-1\.0|\bx11 license\b|artistic licen[cs]e|artistic-\d|\bosl\b|\bcpal\b|\bcpl\b|\bnposl\b|blueoak|\bupl\b|mulan|\bms-pl\b|\bms-rl\b|microsoft public license|microsoft reciprocal license|php license/i.test(s)) {
    return 'open-source';
  }
  if (/\bfreeware\b|\bfreemium\b|donationware|cardware|free for personal|free for non-commercial|non-?commercial|creative commons|\bcc[\s-]?by\b|no-fee terms/i.test(s)) {
    return 'freeware';
  }
  if (/proprietary|commercial|\beula\b|end user license|license agreement|all rights reserved|copyright|closed source|\btrial\b|trialware|shareware|©|\(c\)/i.test(s)) {
    return 'proprietary';
  }
  return 'unknown';
}

/**
 * Resolves an installerTypes filter to the set of (winget_id, version) pairs
 * whose installer_type matches, then narrows to the winget_ids whose CURRENT
 * latest_version is one of those matching versions. Two-step because the
 * Supabase JS query builder can't express "join curated_apps to
 * version_history on two columns" directly.
 */
async function resolveInstallerTypeWingetIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  installerTypes: string[]
): Promise<Set<string> | null> {
  const { data, error } = await supabase
    .from('version_history')
    .select('winget_id, version')
    .in('installer_type', installerTypes);
  if (error || !data) return null;
  return new Set(data.map((r: { winget_id: string; version: string }) => `${r.winget_id}::${r.version}`));
}

/**
 * Applies the shared facet filters to a Supabase query builder. Both
 * getPopularApps (data + count queries) and searchApps's ILIKE fallback use
 * this so behavior stays in sync with the SQLite source's buildFilterConditions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryBuilderMethod = (...args: any[]) => any;

function applyCatalogFilters<
  T extends {
    eq: QueryBuilderMethod;
    in: QueryBuilderMethod;
    ilike: QueryBuilderMethod;
    or: QueryBuilderMethod;
    is: QueryBuilderMethod;
    contains: QueryBuilderMethod;
  },
>(
  query: T,
  filters: CatalogFilterOptions | undefined
): T {
  const f = filters || {};
  let q = query;

  if (f.includeLocaleVariants !== true) {
    q = q.eq('is_locale_variant', false);
  }

  if (f.needsCategorization) {
    q = q.is('category', null);
  } else if (f.categories && f.categories.length > 0) {
    q = q.in('category', f.categories);
  }

  if (f.publisher) {
    q = q.ilike('publisher', `%${f.publisher}%`);
  }

  if (f.tag) {
    // Postgres `tags` is a text[] column - `.contains` requires an exact
    // element match, unlike the SQLite source's substring LIKE on the JSON
    // blob. Close enough for an autocomplete-style single-tag pick.
    q = q.contains('tags', [f.tag]);
  }

  if (f.appSources && f.appSources.length > 0) {
    q = q.in('app_source', f.appSources);
  }

  if (f.licenseBuckets && f.licenseBuckets.length > 0) {
    const filterString = buildLicenseBucketFilter(f.licenseBuckets);
    if (filterString) {
      q = q.or(filterString);
    }
  }

  return q;
}

/**
 * Raw Supabase client using the service-or-anon key, matching the
 * getSupabaseClient() helpers previously inlined in winget-api.ts and
 * manifest-api.ts. Returns null when unconfigured (manifest-api semantics);
 * throwing variants handle the missing-config case at the call site.
 */
function serviceOrAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key);
}

export class SupabaseCatalogSource implements CatalogSource {
  // ---------------------------------------------------------------------------
  // search / discovery
  // ---------------------------------------------------------------------------

  async searchApps(
    query: string,
    opts: {
      limit: number;
      category?: string | null;
      sort?: SearchSort;
      filters?: CatalogFilterOptions;
    }
  ): Promise<{ data: CuratedAppRpcRow[] | null; error: { message: string } | null }> {
    const supabase = serviceOrAnonClient();
    if (!supabase) {
      return { data: null, error: { message: 'Supabase configuration missing' } };
    }

    // Same "unknown" no-positive-pattern gap as applyCatalogFilters below,
    // but not fixed here: the search_curated_apps RPC's license_ilike_patterns
    // param is a simple ILIKE-ANY positive match, with no equivalent of
    // buildLicenseBucketFilter's null-or-negated-patterns expression - doing
    // that here would mean another migration to the RPC's SQL. Search
    // results with "Unknown" selected remain effectively unfiltered on
    // license, same as before.
    const licensePatterns = opts.filters?.licenseBuckets?.length
      ? opts.filters.licenseBuckets.flatMap((b) => LICENSE_BUCKET_ILIKE_PATTERNS[b])
      : null;

    const { data: curatedData, error: curatedError } = await supabase.rpc(
      'search_curated_apps',
      {
        search_query: query,
        category_filter: opts.category || opts.filters?.categories?.[0] || null,
        result_limit: opts.limit,
        publisher_filter: opts.filters?.publisher || null,
        tag_filter: opts.filters?.tag || null,
        app_source_filter: opts.filters?.appSources?.length ? opts.filters.appSources : null,
        license_ilike_patterns: licensePatterns?.length ? licensePatterns : null,
        // Full multi-select list - category_filter above only ever carries
        // the first selection (kept for older-caller/RPC-signature
        // backward compatibility). See the multi-category migration for
        // why this pair of params exists instead of just widening
        // category_filter to an array.
        category_filters: opts.filters?.categories?.length ? opts.filters.categories : null,
      }
    );

    return {
      data: (curatedData || null) as CuratedAppRpcRow[] | null,
      error: curatedError,
    };
  }

  async getPopularApps(opts: {
    limit: number;
    offset: number;
    category?: string | null;
    sort: SearchSort;
    filters?: CatalogFilterOptions;
  }): Promise<PopularPackagesResult | null> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return null;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { limit, offset, category, sort } = opts;
    const filters: CatalogFilterOptions = {
      ...opts.filters,
      categories: opts.filters?.categories?.length ? opts.filters.categories : category ? [category] : null,
    };

    let matchingWingetIds: Set<string> | null = null;
    if (filters.installerTypes && filters.installerTypes.length > 0) {
      matchingWingetIds = await resolveInstallerTypeWingetIds(supabase, filters.installerTypes);
      if (!matchingWingetIds || matchingWingetIds.size === 0) {
        return { data: [], total: 0 };
      }
    }
    const candidateWingetIds = matchingWingetIds
      ? Array.from(new Set(Array.from(matchingWingetIds, (k) => k.split('::')[0])))
      : null;

    const buildBaseQuery = (selectArg: string, opts2: { count?: 'exact'; head?: boolean } = {}) => {
      let q = supabase.from('curated_apps').select(selectArg, opts2).eq('is_verified', true);
      q = applyCatalogFilters(q, filters);
      if (candidateWingetIds) {
        q = q.in('winget_id', candidateWingetIds);
      }
      return q;
    };

    let totalCount: number;
    // When an installerTypes filter is active, candidateWingetIds only
    // narrows by winget_id membership (any historical version matched) -
    // exactMatchWingetIds narrows further to just the ids whose CURRENT
    // latest_version actually matches, computed once and reused for both
    // the count and the data query below. Previously this exact-match
    // filter was applied to the data query's rows *after* .range() had
    // already sliced the broader (any-version-match) candidate set, so a
    // page could come back with fewer than `limit` rows even though more
    // exact matches existed further into the candidate set - infinite
    // scroll then advanced its offset by the (already-short) returned
    // count, permanently skipping/duplicating results for the rest of the
    // scroll. Filtering to the exact set BEFORE pagination closes that.
    let exactMatchWingetIds: string[] | null = null;
    if (matchingWingetIds) {
      const { data: countRows, error: countError } = await buildBaseQuery(
        'winget_id, latest_version'
      );
      if (countError) {
        console.error('Failed to count curated packages', { error: countError, filters });
        return null;
      }
      const ids = matchingWingetIds;
      exactMatchWingetIds = Array.from(
        new Set(
          ((countRows || []) as unknown as Array<{ winget_id: string; latest_version: string }>)
            .filter((r) => ids.has(`${r.winget_id}::${r.latest_version}`))
            .map((r) => r.winget_id)
        )
      );
      totalCount = exactMatchWingetIds.length;
      if (exactMatchWingetIds.length === 0) {
        return { data: [], total: 0 };
      }
    } else {
      const { count, error: countError } = await buildBaseQuery('*', {
        count: 'exact',
        head: true,
      });
      if (countError) {
        console.error('Failed to count curated packages', { error: countError, filters });
        return null;
      }
      totalCount = count || 0;
    }

    let dataQuery = buildBaseQuery(
      'id, winget_id, name, publisher, latest_version, description, homepage, category, tags, icon_path, popularity_rank, app_source, store_package_id, license, winget_last_update'
    );
    if (exactMatchWingetIds) {
      dataQuery = dataQuery.in('winget_id', exactMatchWingetIds);
    }

    switch (sort) {
      case 'name':
        dataQuery = dataQuery.order('name', { ascending: true });
        break;
      case 'newest':
        dataQuery = dataQuery.order('winget_last_update', { ascending: false, nullsFirst: false });
        break;
      case 'popular':
      default:
        dataQuery = dataQuery
          .order('popularity_rank', { ascending: true, nullsFirst: false })
          .order('name', { ascending: true });
        break;
    }

    const { data, error } = await dataQuery.range(offset, offset + limit - 1);

    if (error) {
      console.error('Failed to query curated packages', { error, filters, sort, limit, offset });
      return null;
    }

    const rows = (data || []) as unknown as Array<
      PopularPackagesResult['data'][number] & { license?: string | null }
    >;

    return {
      data: rows.map((r) => ({ ...r, license_bucket: classifyLicenseForDisplay(r.license) })),
      total: totalCount || 0,
    };
  }

  async getPopularPackages(
    limit: number,
    category?: string | null
  ): Promise<{ data: CuratedAppRpcRow[] | null; error: { message: string } | null }> {
    const supabase = serviceOrAnonClient();
    if (!supabase) {
      return { data: null, error: { message: 'Supabase configuration missing' } };
    }

    const { data: curatedData, error: curatedError } = await supabase.rpc(
      'get_popular_curated_apps',
      {
        result_limit: limit,
        category_filter: category || null,
      }
    );

    return {
      data: (curatedData || null) as CuratedAppRpcRow[] | null,
      error: curatedError,
    };
  }

  async getCategories(): Promise<CategoryCount[]> {
    const supabase = serviceOrAnonClient();
    if (!supabase) {
      return [];
    }

    const { data, error } = await supabase.rpc('get_curated_categories');

    if (error) {
      console.error('Error getting categories:', error);
      return [];
    }

    return ((data || []) as { category: string; app_count: number }[]).map((c) => ({
      category: c.category,
      count: c.app_count,
    }));
  }

  async getCategoryCount(opts: { verifiedOnly: boolean }): Promise<number | null> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return null;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    let query = supabase
      .from('curated_apps')
      .select('*', { count: 'exact', head: true });

    if (opts.verifiedOnly) {
      query = query.eq('is_verified', true);
    }

    const { count } = await query;
    return count ?? null;
  }

  async getUncategorizedCount(): Promise<number | null> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return null;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { count } = await supabase
      .from('curated_apps')
      .select('*', { count: 'exact', head: true })
      .eq('is_verified', true)
      .eq('is_locale_variant', false)
      .is('category', null);

    return count ?? null;
  }

  // ---------------------------------------------------------------------------
  // app detail
  // ---------------------------------------------------------------------------

  async getAppByWingetId(wingetId: string): Promise<CuratedAppWithDetails | null> {
    const supabase = serviceOrAnonClient();
    if (!supabase) {
      return null;
    }

    const { data: curatedData } = await supabase
      .from('curated_apps')
      .select('*')
      .eq('winget_id', wingetId)
      .single();

    if (!curatedData) {
      return null;
    }

    // Get versions from version_history
    const { data: versionData } = await supabase
      .from('version_history')
      .select('version')
      .eq('winget_id', wingetId)
      .order('created_at', { ascending: false });

    const versions = versionData?.map((v) => v.version) || [];

    // Fetch locale variants if this is a parent app (not a variant itself)
    let localeVariants: LocaleVariant[] | undefined;
    if (!curatedData.is_locale_variant) {
      const { data: variantData } = await supabase.rpc('get_locale_variants', {
        parent_id: wingetId,
      });
      if (variantData && variantData.length > 0) {
        localeVariants = variantData.map(
          (v: { winget_id: string; locale_code: string; latest_version: string | null }) => {
            const display = getLocaleDisplay(v.locale_code);
            return {
              wingetId: v.winget_id,
              localeCode: v.locale_code,
              localeName: display.name,
              countryFlag: display.flag,
              version: v.latest_version || undefined,
            };
          }
        );
      }
    }

    return {
      app: curatedData as CuratedAppWithDetails['app'],
      versions,
      localeVariants,
    };
  }

  async getLocaleVariants(parentWingetId: string): Promise<LocaleVariant[]> {
    const supabase = serviceOrAnonClient();
    if (!supabase) {
      return [];
    }

    const { data: variantData, error } = await supabase.rpc('get_locale_variants', {
      parent_id: parentWingetId,
    });
    if (error || !variantData || variantData.length === 0) {
      return [];
    }

    return variantData.map(
      (v: { winget_id: string; locale_code: string; latest_version: string | null }) => {
        const display = getLocaleDisplay(v.locale_code);
        return {
          wingetId: v.winget_id,
          localeCode: v.locale_code,
          localeName: display.name,
          countryFlag: display.flag,
          flagEmoji: countryCodeToFlag(display.flag),
          version: v.latest_version || undefined,
        };
      }
    );
  }

  async getVersions(wingetId: string): Promise<string[]> {
    const supabase = serviceOrAnonClient();
    if (!supabase) {
      return [];
    }

    const { data } = await supabase
      .from('version_history')
      .select('version')
      .eq('winget_id', wingetId)
      .order('created_at', { ascending: false });

    if (data && data.length > 0) {
      return data.map((v) => v.version);
    }

    return [];
  }

  async getVersionInstallerInfo(
    wingetId: string,
    version: string
  ): Promise<VersionInstallerInfo | null> {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('version_history')
      .select('installer_url, installer_sha256, installer_type, installer_scope, installers')
      .eq('winget_id', wingetId)
      .eq('version', version)
      .single();

    if (error || !data) {
      return null;
    }

    return data as unknown as VersionInstallerInfo;
  }

  async getLatestVersionInstallerInfo(
    wingetId: string,
    version: string
  ): Promise<VersionInstallerInfo | null> {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('version_history')
      .select('installer_url, installer_sha256, installer_type, installer_scope, installers')
      .eq('winget_id', wingetId)
      .eq('version', version)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return data as unknown as VersionInstallerInfo;
  }

  async getInstallationChangelog(
    wingetId: string,
    version?: string
  ): Promise<InstallationSnapshot | null> {
    const supabase = serviceOrAnonClient();
    if (!supabase) {
      return null;
    }

    const { data, error } = await supabase.rpc('get_installation_changelog', {
      app_winget_id: wingetId,
      app_version: version || null,
    });

    if (error || !data || data.length === 0) {
      return null;
    }

    return data[0] as InstallationSnapshot;
  }

  // ---------------------------------------------------------------------------
  // update detection
  // ---------------------------------------------------------------------------

  async getAppsByWingetIds(ids: string[]): Promise<WingetIdLatestVersion[]> {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('curated_apps')
      .select('winget_id, latest_version')
      .in('winget_id', ids);

    if (error || !data) {
      return [];
    }

    return data as WingetIdLatestVersion[];
  }

  async getAllLatestVersions(): Promise<WingetIdLatestVersion[]> {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('curated_apps')
      .select('winget_id, latest_version')
      .not('latest_version', 'is', null);

    // Preserve the original cron behavior: propagate the error so the route's
    // outer try/catch returns a 500 (it did `throw curatedError`).
    if (error) {
      throw error;
    }

    return (data || []) as WingetIdLatestVersion[];
  }

  // ---------------------------------------------------------------------------
  // small metadata lookups
  // ---------------------------------------------------------------------------

  async getAppNamePublisher(
    wingetId: string
  ): Promise<{ name: string; publisher: string | null } | null> {
    const supabase = createServerClient();

    const { data } = await supabase
      .from('curated_apps')
      .select('name, publisher')
      .eq('winget_id', wingetId)
      .single();

    if (!data) {
      return null;
    }

    return data as { name: string; publisher: string | null };
  }

  async getAppForInstaller(wingetId: string): Promise<{
    winget_id: string;
    name: string;
    latest_version: string | null;
  } | null> {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('curated_apps')
      .select('winget_id, name, latest_version')
      .eq('winget_id', wingetId)
      .single();

    if (error || !data) {
      return null;
    }

    return data as { winget_id: string; name: string; latest_version: string | null };
  }

  async getSccmCuratedApp(wingetId: string): Promise<SccmCuratedAppRow | null> {
    const supabase = createServerClient();

    const { data, error } = (await supabase
      .from('curated_apps')
      .select(
        'winget_id, name, publisher, latest_version, description, homepage, license, tags, category, icon_path'
      )
      .eq('winget_id', wingetId)
      .single()) as { data: SccmCuratedAppRow | null; error: Error | null };

    if (error || !data) {
      return null;
    }

    return data;
  }

  async getAppDescription(wingetId: string): Promise<string | undefined> {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('curated_apps')
      .select('description')
      .eq('winget_id', wingetId)
      .limit(1)
      .maybeSingle();

    if (error || !data?.description || typeof data.description !== 'string') {
      return undefined;
    }

    return data.description;
  }

  // ---------------------------------------------------------------------------
  // matching
  // ---------------------------------------------------------------------------

  async searchCuratedAppsForMatching(term: string): Promise<CuratedAppMatch[]> {
    if (!term || term.length < 2) {
      return [];
    }

    const normalizedSearch = term.toLowerCase().trim();
    const supabase = createServerClient();
    const pattern = quotePostgrestOrValue(`%${normalizedSearch}%`);

    try {
      const { data, error } = await supabase
        .from('curated_apps')
        .select('winget_id, name, publisher, latest_version')
        .not('latest_version', 'is', null)
        .or(
          `name.ilike.${pattern},publisher.ilike.${pattern},winget_id.ilike.${pattern}`
        )
        .order('popularity_rank', { ascending: true, nullsFirst: false })
        .limit(10);

      if (error) {
        console.error('Error searching curated apps:', error.message);
        return [];
      }

      if (!data || data.length === 0) {
        return [];
      }

      return (
        data as Array<{
          winget_id: string;
          name: string;
          publisher: string;
          latest_version: string | null;
        }>
      ).map((app) => ({
        wingetId: app.winget_id,
        name: app.name,
        publisher: app.publisher,
        latestVersion: app.latest_version,
      }));
    } catch (e) {
      console.error('Failed to search curated apps:', e);
      return [];
    }
  }

  async getSccmMapping(
    query: SccmMappingQuery,
    tenantId: string
  ): Promise<SccmMappingResult | null> {
    const supabase = createServerClient();

    const { displayNameNormalized, ciId, productCode } = query;

    // sccm_winget_mappings columns are snake_case. Read the row with the actual
    // column names: reading camelCase here returned undefined and threw on
    // wingetPackageId.split(...), which surfaced as a 500 on Run Matching for any
    // app that hit a seeded mapping (e.g. "google chrome").
    type SccmWingetMappingRow = {
      id: string;
      winget_package_id: string | null;
      winget_package_name: string | null;
      confidence: number | null;
      is_verified: boolean | null;
      tenant_id: string | null;
      sccm_product_code: string | null;
    };

    // Build the OR conditions defensively: quote values so names containing
    // spaces or parentheses (e.g. "Zoom Workplace (64-bit)") don't break the
    // PostgREST or() parser, and only filter on product code when one exists
    // (eq.null would not match NULL rows anyway).
    const quote = (v: string) => `"${v.replace(/"/g, '')}"`;
    const orConditions = [
      `sccm_display_name_normalized.eq.${quote(displayNameNormalized)}`,
      `sccm_ci_id.eq.${quote(ciId)}`,
    ];
    if (productCode) {
      orConditions.push(`sccm_product_code.eq.${quote(productCode)}`);
    }

    // sccm_winget_mappings is not in the generated Database types; use the
    // same loosely-typed access shape the original checkSccmMapping used.
    const looseClient = supabase as unknown as {
      from: (table: string) => {
        select: (columns: string) => {
          or: (filter: string) => {
            order: (column: string, options: { ascending: boolean }) => {
              limit: (count: number) => Promise<{
                data: SccmWingetMappingRow[] | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    };

    const { data, error } = await looseClient
      .from('sccm_winget_mappings')
      .select('*')
      .or(orConditions.join(','))
      .order('is_verified', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      return null;
    }

    const mapping = data[0];

    // Check tenant scope
    if (mapping.tenant_id && mapping.tenant_id !== tenantId) {
      return null;
    }

    // Guard against a mapping row without a winget package id.
    const wingetId = mapping.winget_package_id;
    if (!wingetId) {
      return null;
    }

    return {
      status: 'matched',
      wingetId,
      wingetName: mapping.winget_package_name || wingetId.split('.').pop() || wingetId,
      confidence: mapping.confidence ?? 1.0,
      partialMatches: [],
      matchedBy: mapping.sccm_product_code && productCode ? 'product_code' : 'mapping',
      mappingId: mapping.id,
    };
  }

  // ---------------------------------------------------------------------------
  // existence checks
  // ---------------------------------------------------------------------------

  async appExists(wingetId: string): Promise<boolean> {
    const supabase = createServerClient();

    const { data } = await supabase
      .from('curated_apps')
      .select('id, winget_id')
      .eq('winget_id', wingetId)
      .single();

    return Boolean(data);
  }

  async appExistsCaseInsensitive(
    wingetId: string
  ): Promise<{ winget_id: string } | null> {
    const supabase = createServerClient();

    // ILIKE treats `%`/`_` in the pattern as wildcards - without escaping
    // them, a winget_id containing a literal underscore (a normal, common
    // character in real WinGet IDs) would match any other ID that merely
    // has some other character in that position, risking a false
    // "already exists" response.
    const escapedWingetId = wingetId.replace(/[\\%_]/g, '\\$&');
    const { data } = await supabase
      .from('curated_apps')
      .select('id, winget_id')
      .ilike('winget_id', escapedWingetId)
      .limit(1)
      .maybeSingle();

    return (data as { winget_id: string } | null) || null;
  }

  async findSimilarVerifiedApps(
    term: string,
    limit: number
  ): Promise<{ winget_id: string; name: string }[]> {
    const supabase = createServerClient();

    const pattern = quotePostgrestOrValue(`%${term}%`);
    const { data } = await supabase
      .from('curated_apps')
      .select('winget_id, name')
      .or(`winget_id.ilike.${pattern},name.ilike.${pattern}`)
      .eq('is_verified', true)
      .limit(limit);

    return (data as { winget_id: string; name: string }[] | null) || [];
  }

  // ---------------------------------------------------------------------------
  // stats
  // ---------------------------------------------------------------------------

  async getCatalogStats(): Promise<{ totalApps: number }> {
    // The stats route builds its own client (service-role-only) and runs this
    // count alongside a site_counters query; here we only own the catalog count.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return { totalApps: 0 };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { count } = await supabase
      .from('curated_apps')
      .select('*', { count: 'exact', head: true });

    return { totalApps: count ?? 0 };
  }
}
